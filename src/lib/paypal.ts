import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { tool, type Tool, type ToolSet } from "ai";
import { randomUUID } from "node:crypto";
import type { Mandate } from "./types";

/**
 * PayPal access for Errandly.
 *  - The PayPal Agent Toolkit gives the agent read tools (orders, transactions)
 *    and owns OAuth for every REST call below.
 *  - Payment Method Tokens v3 vaults the user's PayPal wallet once, with the
 *    user's explicit consent, when they activate a mandate.
 *  - Orders v2 charges that vaulted wallet later with no user present
 *    (merchant-initiated), which is what lets an agent complete a purchase.
 */

const ACTIONS = {
  orders: { get: true },
  transactions: { list: true },
};

let toolkit: PayPalAgentToolkit | null = null;

export function isSandbox(): boolean {
  return (process.env.PAYPAL_ENVIRONMENT ?? "SANDBOX").toUpperCase() !== "PRODUCTION";
}

export function hasPayPalCredentials(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export function getToolkit(): PayPalAgentToolkit {
  if (toolkit) return toolkit;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (see .env.example)");
  }
  toolkit = new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: { actions: ACTIONS, context: { sandbox: isSandbox() } },
  });
  return toolkit;
}

export class PayPalHttpError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
  }
}

type AnyRecord = Record<string, unknown>;

export async function paypalFetch<T = AnyRecord>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; requestId?: string } = {},
): Promise<T> {
  const tk = getToolkit();
  const token = await tk.client.getAccessToken();
  const base = tk.client.getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "PayPal-Request-Id": init.requestId ?? randomUUID(),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (!res.ok) {
    const j = (json ?? {}) as AnyRecord;
    const issues = Array.isArray(j.details)
      ? (j.details as AnyRecord[]).map((d) => `${d.issue ?? ""} ${d.description ?? ""}`.trim()).join("; ")
      : "";
    const detail = [j.message, issues, j.error_description].filter(Boolean).join(" | ") || res.statusText;
    throw new PayPalHttpError(res.status, json, `PayPal ${init.method ?? "GET"} ${path} failed (${res.status}): ${detail}`);
  }
  return json as T;
}

/* ------------------------------------------------------------------ */
/* Vault: consent once, charge later                                   */
/* ------------------------------------------------------------------ */

export async function createSetupToken(mandate: Mandate, appUrl: string): Promise<{ id: string; approveUrl: string }> {
  const res = await paypalFetch<{ id: string; status: string; links?: { rel: string; href: string }[] }>(
    "/v3/vault/setup-tokens",
    {
      method: "POST",
      body: {
        payment_source: {
          paypal: {
            description: `Errandly mandate: ${mandate.name}`.slice(0, 127),
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
            usage_pattern: "UNSCHEDULED_PREPAID",
            permit_multiple_payment_tokens: false,
            experience_context: {
              brand_name: "Errandly",
              shipping_preference: "NO_SHIPPING",
              user_action: "SETUP_NOW",
              return_url: `${appUrl}/api/paypal/return?mandate=${mandate.id}`,
              cancel_url: `${appUrl}/api/paypal/cancel?mandate=${mandate.id}`,
            },
          },
        },
      },
    },
  );
  const approve = res.links?.find((l) => l.rel === "approve")?.href;
  if (!approve) throw new Error(`Setup token ${res.id} has no approve link (status ${res.status})`);
  return { id: res.id, approveUrl: approve };
}

export async function exchangeSetupToken(setupTokenId: string): Promise<{ vaultId: string; customerId?: string; payerEmail?: string }> {
  const res = await paypalFetch<{ id: string; customer?: { id?: string }; payment_source?: { paypal?: { email_address?: string } } }>(
    "/v3/vault/payment-tokens",
    { method: "POST", body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } } },
  );
  return { vaultId: res.id, customerId: res.customer?.id, payerEmail: res.payment_source?.paypal?.email_address };
}

export async function deletePaymentToken(vaultId: string): Promise<void> {
  await paypalFetch(`/v3/vault/payment-tokens/${encodeURIComponent(vaultId)}`, { method: "DELETE" });
}

export type ChargeArgs = {
  vaultId: string;
  amount: number;
  currency: string;
  description: string;
  customId: string;
  items?: { name: string; quantity: number; unitAmount: number; url?: string }[];
};

export type ChargeResult = { orderId: string; status: string; captureId?: string; payerEmail?: string };

/** Merchant-initiated charge against a vaulted PayPal wallet. No user present. */
export async function chargeVault(args: ChargeArgs): Promise<ChargeResult> {
  const value = args.amount.toFixed(2);
  const items = args.items?.map((it) => ({
    name: it.name.slice(0, 127),
    quantity: String(it.quantity),
    unit_amount: { currency_code: args.currency, value: it.unitAmount.toFixed(2) },
    url: it.url,
  }));
  const order = await paypalFetch<AnyRecord>("/v2/checkout/orders", {
    method: "POST",
    requestId: `errand-${args.customId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: args.customId,
          custom_id: args.customId,
          description: args.description.slice(0, 127),
          amount: {
            currency_code: args.currency,
            value,
            ...(items ? { breakdown: { item_total: { currency_code: args.currency, value } } } : {}),
          },
          ...(items ? { items } : {}),
        },
      ],
      payment_source: {
        paypal: {
          vault_id: args.vaultId,
          stored_credential: {
            payment_initiator: "MERCHANT",
            usage: "SUBSEQUENT",
            usage_pattern: "UNSCHEDULED_PREPAID",
          },
        },
      },
    },
  });

  let final = order;
  let status = String(order.status ?? "");
  if (status === "APPROVED" || status === "CREATED") {
    final = await paypalFetch<AnyRecord>(`/v2/checkout/orders/${String(order.id)}/capture`, {
      method: "POST",
      requestId: `errand-cap-${args.customId}`,
      body: {},
    });
    status = String(final.status ?? status);
  }
  if (status !== "COMPLETED") {
    throw new PayPalHttpError(422, final, `Order ${String(order.id)} ended in status ${status}; the vaulted wallet could not be charged`);
  }
  const pu = ((final.purchase_units as AnyRecord[] | undefined) ?? [])[0] ?? {};
  const captures = ((pu.payments as AnyRecord | undefined)?.captures as AnyRecord[] | undefined) ?? [];
  const payer = (final.payment_source as AnyRecord | undefined)?.paypal as AnyRecord | undefined;
  return {
    orderId: String(final.id ?? order.id),
    status,
    captureId: captures[0]?.id ? String(captures[0].id) : undefined,
    payerEmail: payer?.email_address ? String(payer.email_address) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Toolkit adapter (AI SDK v4 tool shape -> v7)                        */
/* ------------------------------------------------------------------ */

type LegacyTool = {
  description?: string;
  parameters: unknown;
  execute?: (args: unknown, options?: unknown) => Promise<unknown>;
};

export function paypalReadTools(): ToolSet {
  const legacy = getToolkit().getTools() as unknown as Record<string, LegacyTool>;
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(legacy)) {
    out[name] = tool({
      description: t.description ?? name,
      inputSchema: t.parameters as never,
      execute: async (input: unknown, options) => {
        if (!t.execute) throw new Error(`${name} has no executor`);
        const raw = await t.execute(input, { toolCallId: options.toolCallId, messages: [] });
        if (typeof raw !== "string") return raw;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      },
    }) as Tool;
  }
  return out;
}

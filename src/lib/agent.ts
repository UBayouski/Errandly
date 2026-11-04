import { generateObject, generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { channel3Enabled, searchProducts } from "./channel3";
import { getModel, providerOptions } from "./model";
import { chargeVault, paypalReadTools } from "./paypal";
import { describePolicy, evaluate, formatMoney, spentInPeriod, categoryVerdict } from "./policy";
import { claimRun, getMandate, getRun, listRuns, newId, now, saveMandate, saveRun, updateRun } from "./store";
import type { Mandate, Policy, Proposal, Run, RunStep } from "./types";

/* ------------------------------------------------------------------ */
/* Mandate creation: plain words -> structured policy                  */
/* ------------------------------------------------------------------ */

const policySchema = z.object({
  name: z.string().describe("Short mandate name, 2-5 words, e.g. 'Office supplies' or 'Weekly groceries'"),
  currency: z.string().default("USD"),
  perTransactionMax: z.number().positive().describe("Max for a single purchase"),
  periodMax: z.number().positive().describe("Max total spend per period"),
  period: z.enum(["day", "week", "month"]),
  autoApproveBelow: z
    .number()
    .min(0)
    .describe("Purchases at or below this run without asking. If the user did not say, use 50% of perTransactionMax."),
  maxPurchasesPerPeriod: z.number().int().positive().describe("If unspecified, infer something sensible like 5"),
  allowedCategories: z.array(z.string()).describe("Lower-case category keywords the user allowed; empty if unrestricted"),
  blockedCategories: z.array(z.string()).describe("Lower-case category keywords the user forbade"),
  allowedMerchants: z.array(z.string()).describe("Retailer domains like amazon.com; empty if unrestricted"),
  blockedMerchants: z.array(z.string()),
  expiresAt: z.string().nullable().describe("ISO 8601 date-time, or null if the user gave no expiry"),
  notes: z.string().describe("Any other constraints in one sentence, or empty"),
});

export async function parseMandate(text: string): Promise<{ name: string; policy: Policy }> {
  const { object } = await generateObject({
    model: getModel(),
    schema: policySchema,
    providerOptions,
    system:
      "You turn a person's plain-language spending instruction for a shopping agent into a precise spend policy. " +
      "Be conservative: when a limit is ambiguous, pick the stricter reading. Never invent permissions the user did not grant. " +
      "Categories are generic keywords (e.g. 'printer ink', 'groceries', 'alcohol', 'gift cards'). Merchants are bare domains. " +
      "Common-sense blocks the user would expect from a household agent (alcohol, gift cards, gambling) belong in blockedCategories unless the user explicitly allowed them. " +
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
    prompt: text,
  });
  const { name, ...policy } = object;
  return { name, policy };
}

export async function createMandate(text: string): Promise<Mandate> {
  const { name, policy } = await parseMandate(text);
  const mandate: Mandate = {
    id: newId(),
    name,
    description: text,
    policy,
    status: "needs_paypal",
    createdAt: now(),
    paypal: {},
  };
  return saveMandate(mandate);
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

export async function startRun(mandateId: string, task: string): Promise<Run> {
  const mandate = await getMandate(mandateId);
  if (!mandate) throw new Error("Mandate not found");
  const run: Run = {
    id: newId(),
    mandateId,
    task,
    status: "running",
    createdAt: now(),
    updatedAt: now(),
    steps: [{ at: now(), type: "thought", title: "Errand started", detail: task }],
  };
  await saveRun(run);
  // Fire and forget; the client polls GET /api/runs/:id.
  void executeRun(run.id).catch(async (err) => {
    console.error("[run]", run.id, err);
    await updateRun(run.id, (r) => {
      r.status = "failed";
      r.error = err instanceof Error ? err.message : String(err);
      r.steps.push({ at: now(), type: "error", title: "Run failed", detail: r.error });
    });
  });
  return run;
}

function step(type: RunStep["type"], title: string, detail?: string, data?: unknown): RunStep {
  return { at: now(), type, title, detail, data };
}

const proposalSchema = z.object({
  productId: z.string(),
  title: z.string(),
  merchantDomain: z.string().describe("Retailer domain from the chosen offer, e.g. staples.com"),
  offerUrl: z.string(),
  imageUrl: z.string().optional(),
  amount: z.number().positive().describe("Unit price from the offer"),
  currency: z.string(),
  quantity: z.number().int().positive().default(1),
  category: z
    .string()
    .describe("Short generic category for policy matching, e.g. 'printer ink', 'coffee', 'electronics'. Use the product's category path when available."),
  rationale: z.string().describe("One or two sentences: why this product and this offer"),
  source: z.enum(["channel3", "demo"]),
});

async function executePurchase(runId: string, mandate: Mandate, proposal: Proposal): Promise<Run> {
  const total = Math.round(proposal.amount * proposal.quantity * 100) / 100;
  const result = await chargeVault({
    vaultId: mandate.paypal.vaultId!,
    amount: total,
    currency: proposal.currency,
    description: `Errandly: ${proposal.title}`,
    customId: runId,
    items: [{ name: proposal.title, quantity: proposal.quantity, unitAmount: proposal.amount, url: proposal.offerUrl }],
  });
  return updateRun(runId, (r) => {
    r.payment = {
      orderId: result.orderId,
      captureId: result.captureId,
      status: result.status,
      amount: total,
      currency: proposal.currency,
      payerEmail: result.payerEmail,
      at: now(),
    };
    r.steps.push(
      step(
        "payment",
        `Charged ${formatMoney(total, proposal.currency)} via PayPal`,
        `Order ${result.orderId}${result.captureId ? `, capture ${result.captureId}` : ""}, status ${result.status}. Merchant-initiated charge against the vaulted wallet; no checkout screen.`,
        result,
      ),
      step(
        "fulfillment",
        `Order placed with ${proposal.merchantDomain}`,
        proposal.source === "demo"
          ? "Demo catalog item: retailer hand-off is simulated."
          : "Retailer hand-off is simulated in this build. Production would complete checkout through the retailer's agentic checkout or affiliate API using the buy link.",
        { url: proposal.offerUrl },
      ),
    );
  });
}

async function executeRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const mandate = await getMandate(run.mandateId);
  if (!mandate) throw new Error("Mandate not found");
  const runs = await listRuns(mandate.id);
  const { spent, count } = spentInPeriod(mandate, runs);
  const p = mandate.policy;
  const remaining = Math.max(0, p.periodMax - spent);
  const searchCap = Math.min(p.perTransactionMax, remaining);
  const MAX_SEARCHES = 3;
  let searches = 0;
  let noMatch: string | null = null;

  const tools = {
    search_products: tool({
      description: `Search real retail products across thousands of stores. Returns candidates with their cheapest in-stock offer at or under the price cap. At most ${MAX_SEARCHES} searches per errand; after that you must decide.`,
      inputSchema: z.object({
        query: z.string(),
        maxPrice: z.number().positive().optional(),
        limit: z.number().int().min(1).max(12).default(8),
      }),
      execute: async ({ query, maxPrice, limit }) => {
        if (searches >= MAX_SEARCHES) {
          return {
            error: `Search limit of ${MAX_SEARCHES} reached. Pick the best candidate you have already seen and call propose_purchase, or call report_no_match if nothing fits the task.`,
          };
        }
        searches += 1;
        const cap = Math.min(maxPrice ?? searchCap, searchCap);
        const raw = await searchProducts({
          query,
          maxPrice: cap,
          limit,
          currency: p.currency,
          merchantDomains: p.allowedMerchants.length ? p.allowedMerchants : undefined,
        });
        // The search API does not always honour the price filter; enforce it here.
        const results = raw.filter((r) => r.bestOffer && r.bestOffer.price <= cap);
        await updateRun(runId, (r) =>
          r.steps.push(
            step(
              "search",
              `Searched "${query}"`,
              `${results.length} results under ${formatMoney(cap, p.currency)} from ${channel3Enabled() ? "Channel3" : "the demo catalog"}${
                p.allowedMerchants.length ? ` (${p.allowedMerchants.join(", ")} only)` : ""
              }${raw.length > results.length ? `; ${raw.length - results.length} over budget dropped` : ""}${
                results.length ? `. Top: ${results.slice(0, 3).map((r) => `${r.title.slice(0, 48)} (${formatMoney(r.bestOffer!.price, r.bestOffer!.currency || p.currency)})`).join("; ")}` : ""
              }`,
              results.slice(0, 6),
            ),
          ),
        );
        return results.map((r) => ({
          productId: r.id,
          title: r.title,
          brand: r.brand,
          category: r.category,
          imageUrl: r.imageUrl,
          bestOffer: r.bestOffer,
          offerCount: r.offerCount,
          source: r.source,
        }));
      },
    }),
    propose_purchase: tool({
      description:
        "Propose exactly one purchase. The policy engine evaluates it against the mandate and either executes the PayPal payment immediately (outcome 'auto'), pauses for the owner's approval ('approval'), or refuses ('deny') with reasons. Call this at most twice per errand.",
      inputSchema: proposalSchema,
      execute: async (input) => {
        const proposal: Proposal = input;
        const current = await listRuns(mandate.id);
        const decision = evaluate(mandate, proposal, current);
        const total = Math.round(proposal.amount * proposal.quantity * 100) / 100;
        await updateRun(runId, (r) => {
          r.proposal = proposal;
          r.decision = decision;
          r.steps.push(
            step(
              "policy",
              decision.outcome === "deny"
                ? `Policy refused ${proposal.title}`
                : decision.outcome === "approval"
                  ? `Policy requires approval for ${formatMoney(total, proposal.currency)}`
                  : `Policy auto-approved ${formatMoney(total, proposal.currency)}`,
              decision.reasons.join(" "),
              decision,
            ),
          );
          if (decision.outcome === "approval") {
            r.status = "awaiting_approval";
            r.steps.push(step("approval", "Waiting for the owner", "The owner must approve or decline this purchase."));
          }
        });
        if (decision.outcome === "deny") {
          return { outcome: "deny", reasons: decision.reasons, remainingThisPeriod: decision.remainingAfter + total };
        }
        if (decision.outcome === "approval") {
          return {
            outcome: "approval",
            instruction:
              "Stop here. Do not search or propose again. Tell the owner, in two sentences, what you picked, the price, and that you are waiting for their approval.",
          };
        }
        try {
          const updated = await executePurchase(runId, mandate, proposal);
          return { outcome: "auto", payment: updated.payment };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await updateRun(runId, (r) => r.steps.push(step("error", "Payment failed", message)));
          return { outcome: "payment_failed", error: message };
        }
      },
    }),
    refuse_task: tool({
      description:
        "Use BEFORE searching when the task itself is for a category the mandate blocks or does not allow (for example alcohol on an office-supplies mandate). The policy engine checks the category and records the refusal. If the category is actually allowed, you are told to search instead.",
      inputSchema: z.object({
        category: z.string().describe("Short generic category of what the owner asked for, e.g. 'alcohol', 'electronics', 'coffee'"),
      }),
      execute: async ({ category }) => {
        const verdict = categoryVerdict(p, category);
        if (verdict.pass) {
          return { refused: false, instruction: `${verdict.reason}. Search for it instead.` };
        }
        await updateRun(runId, (r) => {
          r.decision = {
            outcome: "deny",
            checks: [{ name: "Category", pass: false, detail: verdict.reason }],
            reasons: [verdict.reason],
            spentThisPeriod: spent,
            purchasesThisPeriod: count,
            remainingAfter: remaining,
          };
          r.status = "denied";
          r.steps.push(step("policy", `Policy refused the errand`, verdict.reason, r.decision));
        });
        return { refused: true, reason: verdict.reason, instruction: "Finish now: tell the owner in one or two sentences why this was refused. Nothing was charged." };
      },
    }),
    report_no_match: tool({
      description:
        "Use after searching when nothing genuinely matches the task within the price cap and allowed merchants. Records the outcome; nothing is charged.",
      inputSchema: z.object({ reason: z.string().describe("One or two sentences for the owner: what was searched and why nothing fit") }),
      execute: async ({ reason }) => {
        noMatch = reason;
        await updateRun(runId, (r) => {
          r.status = "no_match";
          r.steps.push(step("thought", "No suitable product found", reason));
        });
        return { ok: true, instruction: "Finish now with a short message to the owner repeating this reason." };
      },
    }),
    ...paypalReadTools(),
  };

  const system = `You are Errandly, a shopping agent that acts under a signed spending mandate from its owner. You never pay with anything except the mandate's vaulted PayPal wallet, and the policy engine (not you) decides whether a purchase may go ahead.

Mandate "${mandate.name}": ${mandate.description}
Policy:
${describePolicy(p)}
Spent so far this ${p.period}: ${formatMoney(spent, p.currency)} across ${count} purchases. Remaining: ${formatMoney(remaining, p.currency)}.

How to run an errand:
1. Search with a specific query and maxPrice no higher than ${formatMoney(searchCap, p.currency)}. Results are already limited to the merchants the policy allows${
    p.allowedMerchants.length ? ` (${p.allowedMerchants.join(", ")})` : ""
  } and to the price cap. You get at most ${MAX_SEARCHES} searches; use different wording if the first is poor, then decide.
2. Pick the cheapest in-stock offer that genuinely matches the task; when several match, lowest total price wins. Do not over-buy; quantity 1 unless the task says otherwise.
3. Every errand ends with exactly one decision: call propose_purchase with the chosen offer's domain, URL and unit price (category: a short generic label), or call report_no_match if nothing relevant was found. Do this even if you suspect the policy will refuse; the refusal and its reasons are the owner's record.
0. Before step 1: if what the owner asked for is clearly in a category the mandate blocks or does not allow, call refuse_task with that category instead of searching.
4. If the outcome is 'deny', explain why in plain words. You may propose one cheaper or compliant alternative if one exists; otherwise stop.
5. If the outcome is 'approval', stop and say you are waiting for approval.
6. If the outcome is 'auto', the payment has already been captured; you may call get_order with the order id to confirm, then report the order id and amount.
Always end with a message for the owner: two to four plain sentences, amounts with currency, no markdown headers. Never claim a purchase happened unless a payment result was returned.
Environment: PayPal ${process.env.PAYPAL_ENVIRONMENT?.toUpperCase() === "PRODUCTION" ? "LIVE" : "SANDBOX"}; product data from ${channel3Enabled() ? "Channel3" : "a demo catalog (no Channel3 key configured)"}.`;

  const result = await generateText({
    model: getModel(),
    system,
    prompt: run.task,
    tools,
    stopWhen: stepCountIs(10),
    providerOptions,
  });

  await updateRun(runId, (r) => {
    const text = result.text.trim();
    if (r.status === "running") {
      if (r.payment) r.status = "completed";
      else if (r.decision?.outcome === "deny") r.status = "denied";
      else if (noMatch) r.status = "no_match";
      else {
        r.status = "failed";
        r.error = "The agent stopped without proposing a purchase or reporting that nothing matched.";
      }
    }
    r.summary =
      text ||
      (r.payment
        ? `Paid ${formatMoney(r.payment.amount, r.payment.currency)} to ${r.proposal?.merchantDomain ?? "the merchant"} for ${r.proposal?.title ?? "the item"}. PayPal order ${r.payment.orderId}.`
        : r.decision?.outcome === "deny"
          ? `Refused by the policy: ${r.decision.reasons.join("; ")}. Nothing was charged.`
          : r.status === "awaiting_approval"
            ? `Waiting for your approval on ${r.proposal?.title ?? "the proposal"}.`
            : noMatch
              ? `Nothing suitable found. ${noMatch}`
              : (r.error ?? "The errand ended without a result."));
    r.steps.push(step("summary", "Agent summary", r.summary));
  });
}

export async function decideRun(runId: string, approved: boolean, reason?: string): Promise<Run> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  if (run.status !== "awaiting_approval" || !run.proposal) throw new Error("Run is not awaiting approval");
  const mandate = await getMandate(run.mandateId);
  if (!mandate) throw new Error("Mandate not found");

  // Claim the run inside the serialised store update. Two simultaneous decisions
  // both pass the read above; only the first claim succeeds, the other throws and
  // the route answers 409. Only the claimant goes on to charge the wallet.
  if (!approved) {
    return claimRun(runId, "awaiting_approval", (r) => {
      r.status = "denied";
      r.steps.push(step("approval", "Owner declined", reason || "No reason given"));
      r.summary = `Declined by the owner${reason ? `: ${reason}` : ""}. Nothing was charged.`;
    });
  }

  await claimRun(runId, "awaiting_approval", (r) => {
    r.status = "running";
    r.steps.push(step("approval", "Owner approved", reason || undefined));
  });
  // Re-check policy at approval time: the period budget may have moved.
  const decision = evaluate(mandate, run.proposal, await listRuns(mandate.id));
  if (decision.outcome === "deny") {
    return updateRun(runId, (r) => {
      r.status = "denied";
      r.decision = decision;
      r.steps.push(step("policy", "Policy refused at execution time", decision.reasons.join(" "), decision));
      r.summary = `Approved, but the policy no longer allows it: ${decision.reasons.join("; ")}`;
    });
  }
  try {
    const updated = await executePurchase(runId, mandate, run.proposal);
    return updateRun(updated.id, (r) => {
      r.status = "completed";
      r.summary = `Approved and paid: ${formatMoney(r.payment!.amount, r.payment!.currency)} to ${r.proposal!.merchantDomain} for ${r.proposal!.title}. PayPal order ${r.payment!.orderId}.`;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return updateRun(runId, (r) => {
      r.status = "failed";
      r.error = message;
      r.steps.push(step("error", "Payment failed", message));
      r.summary = `Approved, but the PayPal charge failed: ${message}`;
    });
  }
}

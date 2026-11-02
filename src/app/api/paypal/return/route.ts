import { exchangeSetupToken } from "@/lib/paypal";
import { getMandate, updateMandate } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * PayPal redirects here after the user approves the setup token. We exchange
 * it for a permanent payment token (the "vault id") and activate the mandate.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mandateId = url.searchParams.get("mandate") ?? "";
  const approvalTokenId = url.searchParams.get("approval_token_id");
  const base = (process.env.APP_URL ?? url.origin).replace(/\/$/, "");
  const back = (q: string) => Response.redirect(`${base}/mandates/${mandateId}?${q}`, 302);

  const mandate = await getMandate(mandateId);
  if (!mandate) return Response.redirect(`${base}/?error=unknown_mandate`, 302);
  const setupTokenId = approvalTokenId ?? mandate.paypal.setupTokenId;
  if (!setupTokenId) return back("error=missing_setup_token");

  try {
    const { vaultId, customerId, payerEmail } = await exchangeSetupToken(setupTokenId);
    await updateMandate(mandateId, (m) => {
      m.paypal = { ...m.paypal, setupTokenId, vaultId, customerId, payerEmail, approvedAt: new Date().toISOString() };
      m.status = "active";
    });
    return back("connected=1");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[paypal/return]", message);
    return back(`error=${encodeURIComponent(message.slice(0, 200))}`);
  }
}

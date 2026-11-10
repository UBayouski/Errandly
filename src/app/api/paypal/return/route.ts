import { deletePaymentToken, exchangeSetupToken } from "@/lib/paypal";
import { activateMandate, connectBlockedReason, getMandate } from "@/lib/store";

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
  // A reload of this page after a successful connect: nothing to do.
  if (mandate.status === "active" && mandate.paypal.vaultId && (!approvalTokenId || approvalTokenId === mandate.paypal.setupTokenId)) {
    return back("connected=1");
  }
  // Revoked, expired or already connected: don't vault a new token for it.
  const blocked = connectBlockedReason(mandate);
  if (blocked) return back(`error=${encodeURIComponent(blocked)}`);
  const setupTokenId = approvalTokenId ?? mandate.paypal.setupTokenId;
  if (!setupTokenId) return back("error=missing_setup_token");

  try {
    const { vaultId, customerId, payerEmail } = await exchangeSetupToken(setupTokenId);
    const { activated, mandate: current } = await activateMandate(mandateId, {
      setupTokenId, vaultId, customerId, payerEmail, approvedAt: new Date().toISOString(),
    });
    if (!activated) {
      // The mandate changed (for example, it was revoked) while PayPal redirected back. Drop the new token.
      await deletePaymentToken(vaultId).catch((err) => console.error("[paypal/return] token cleanup", err instanceof Error ? err.message : err));
      return back(`error=${encodeURIComponent(connectBlockedReason(current) ?? "This mandate cannot be connected.")}`);
    }
    return back("connected=1");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[paypal/return]", message);
    return back(`error=${encodeURIComponent(message.slice(0, 200))}`);
  }
}

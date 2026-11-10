import { createSetupToken, hasPayPalCredentials } from "@/lib/paypal";
import { connectBlockedReason, getMandate, updateMandate } from "@/lib/store";

export const dynamic = "force-dynamic";

function appUrl(req: Request): string {
  return (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
}

/** Start PayPal consent: returns the approve URL for the setup token. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!hasPayPalCredentials()) {
    return Response.json({ error: "PayPal credentials missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET." }, { status: 503 });
  }
  const mandate = await getMandate(id);
  if (!mandate) return Response.json({ error: "Not found" }, { status: 404 });
  const blocked = connectBlockedReason(mandate);
  if (blocked) return Response.json({ error: blocked }, { status: 409 });
  try {
    const { id: setupTokenId, approveUrl } = await createSetupToken(mandate, appUrl(req));
    await updateMandate(id, (m) => {
      m.paypal.setupTokenId = setupTokenId;
    });
    return Response.json({ approveUrl, setupTokenId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[connect]", message);
    return Response.json({ error: message }, { status: 502 });
  }
}

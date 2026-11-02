import { deletePaymentToken } from "@/lib/paypal";
import { spentInPeriod } from "@/lib/policy";
import { getMandate, listRuns, updateMandate } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mandate = await getMandate(id);
  if (!mandate) return Response.json({ error: "Not found" }, { status: 404 });
  const runs = await listRuns(id);
  return Response.json({ mandate, runs, spend: spentInPeriod(mandate, runs) });
}

/** Revoke: deletes the vaulted PayPal payment token so the agent can never charge again. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mandate = await getMandate(id);
  if (!mandate) return Response.json({ error: "Not found" }, { status: 404 });
  let tokenDeleted = false;
  let tokenError: string | undefined;
  if (mandate.paypal.vaultId) {
    try {
      await deletePaymentToken(mandate.paypal.vaultId);
      tokenDeleted = true;
    } catch (err) {
      tokenError = err instanceof Error ? err.message : String(err);
    }
  }
  const updated = await updateMandate(id, (m) => {
    m.status = "revoked";
  });
  return Response.json({ mandate: updated, tokenDeleted, tokenError });
}

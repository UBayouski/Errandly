import { decideRun } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { approved?: boolean; reason?: string };
  if (typeof body.approved !== "boolean") return Response.json({ error: "approved (boolean) is required" }, { status: 400 });
  try {
    const run = await decideRun(id, body.approved, body.reason);
    return Response.json({ run });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 409 });
  }
}

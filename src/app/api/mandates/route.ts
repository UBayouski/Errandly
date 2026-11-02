import { createMandate } from "@/lib/agent";
import { spentInPeriod } from "@/lib/policy";
import { listMandates, listRuns } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const [mandates, runs] = await Promise.all([listMandates(), listRuns()]);
  const out = mandates.map((m) => ({
    ...m,
    spend: spentInPeriod(m, runs),
    runCount: runs.filter((r) => r.mandateId === m.id).length,
    pending: runs.filter((r) => r.mandateId === m.id && r.status === "awaiting_approval").length,
  }));
  return Response.json({ mandates: out });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  if (!text || text.length < 10) {
    return Response.json({ error: "Describe the mandate in a sentence or two." }, { status: 400 });
  }
  try {
    const mandate = await createMandate(text);
    return Response.json({ mandate }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create mandate";
    console.error("[mandates POST]", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

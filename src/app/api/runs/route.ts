import { startRun } from "@/lib/agent";
import { CREDENTIAL_ENV, PROVIDER, hasModelCredentials } from "@/lib/model";
import { hasPayPalCredentials } from "@/lib/paypal";
import { getMandate, listRuns } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const mandateId = new URL(req.url).searchParams.get("mandateId") ?? undefined;
  return Response.json({ runs: await listRuns(mandateId) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { mandateId?: string; task?: string };
  const task = body.task?.trim();
  if (!body.mandateId || !task) return Response.json({ error: "mandateId and task are required" }, { status: 400 });
  if (!hasPayPalCredentials()) {
    return Response.json({ error: "PayPal credentials missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET." }, { status: 503 });
  }
  if (!hasModelCredentials()) {
    return Response.json({ error: `${CREDENTIAL_ENV[PROVIDER]} missing (LLM_PROVIDER=${PROVIDER}).` }, { status: 503 });
  }
  const mandate = await getMandate(body.mandateId);
  if (!mandate) return Response.json({ error: "Mandate not found" }, { status: 404 });
  if (mandate.status !== "active") {
    return Response.json({ error: `Mandate is ${mandate.status.replace("_", " ")}. Connect PayPal first.` }, { status: 409 });
  }
  const run = await startRun(mandate.id, task);
  return Response.json({ run }, { status: 202 });
}

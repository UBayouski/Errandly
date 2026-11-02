import { channel3Enabled } from "@/lib/channel3";
import { CREDENTIAL_ENV, MODEL_ID, PROVIDER, hasModelCredentials } from "@/lib/model";
import { getToolkit, hasPayPalCredentials, isSandbox } from "@/lib/paypal";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, unknown> = {
    paypalCredentials: hasPayPalCredentials(),
    paypalEnvironment: isSandbox() ? "sandbox" : "live",
    modelProvider: PROVIDER,
    modelCredentials: hasModelCredentials() ? "ok" : `missing ${CREDENTIAL_ENV[PROVIDER]}`,
    channel3: channel3Enabled() ? "live" : "demo catalog",
    model: MODEL_ID,
  };
  if (hasPayPalCredentials()) {
    try {
      checks.paypalAuth = (await getToolkit().client.getAccessToken()) ? "ok" : "no token";
    } catch (err) {
      checks.paypalAuth = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  const ok = checks.paypalCredentials === true && checks.modelCredentials === "ok" && checks.paypalAuth === "ok";
  return Response.json({ ok, checks }, { status: ok ? 200 : 503 });
}

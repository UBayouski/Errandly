export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mandateId = url.searchParams.get("mandate") ?? "";
  const base = (process.env.APP_URL ?? url.origin).replace(/\/$/, "");
  return Response.redirect(`${base}/mandates/${mandateId}?cancelled=1`, 302);
}

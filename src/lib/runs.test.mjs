// Time limit and abandoned runs: a stuck errand must end, and never hide a payment.
// Runs against a temp DATA_DIR seeded before the store loads. Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "errandly-runs-"));
process.env.DATA_DIR = dir;
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const run = (id, status, updatedMinutesAgo, extra = {}) => ({
  id, mandateId: "m1", task: "Get coffee filters", status,
  createdAt: minutesAgo(updatedMinutesAgo + 1), updatedAt: minutesAgo(updatedMinutesAgo),
  steps: [{ at: minutesAgo(updatedMinutesAgo), type: "thought", title: "Errand started" }], ...extra,
});
const payment = { orderId: "O1", captureId: "C1", status: "COMPLETED", amount: 7.95, currency: "USD", at: minutesAgo(7) };
writeFileSync(join(dir, "errand.json"), JSON.stringify({
  mandates: [],
  runs: [
    run("abandoned", "running", 15),
    run("abandoned-paid", "running", 15, { payment }),
    run("fresh", "running", 8),
    run("waiting", "awaiting_approval", 60),
  ],
}));

const { getRun, listRuns, recoverLatePayment, stopRun, saveRun } = await import("./store.ts");

test("an errand with no update for over 12 minutes is closed as interrupted, nothing charged", async () => {
  await listRuns();
  const r = await getRun("abandoned");
  assert.equal(r.status, "failed");
  assert.equal(r.interrupted, true);
  assert.match(r.summary, /Nothing was charged/);
});

test("an abandoned errand that already paid is completed, not failed", async () => {
  const r = await getRun("abandoned-paid");
  assert.equal(r.status, "completed");
  assert.equal(r.payment.orderId, "O1");
});

test("an errand quiet for 8 minutes (slow model) and one waiting for approval are left alone", async () => {
  assert.equal((await getRun("fresh")).status, "running");
  assert.equal((await getRun("waiting")).status, "awaiting_approval");
});

test("the time limit stops a running errand and says nothing was charged", async () => {
  await saveRun(run("slow", "running", 0));
  const r = await stopRun("slow", "Took longer than 10 minutes and was stopped.");
  assert.equal(r.status, "failed");
  assert.match(r.summary, /^Took longer than 10 minutes and was stopped\. Nothing was charged\.$/);
});

test("a payment that lands after the stop turns the errand back to completed", () => {
  const r = run("late", "failed", 0, { interrupted: true, payment });
  recoverLatePayment(r);
  assert.equal(r.status, "completed");
  const plain = run("plain-fail", "failed", 0, { payment });
  recoverLatePayment(plain);
  assert.equal(plain.status, "failed", "only runs stopped by the limit are recovered");
});

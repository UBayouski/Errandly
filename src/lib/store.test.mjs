// Two simultaneous approvals must claim the run only once. Runs against a temp DATA_DIR.
// Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "errandly-store-"));
const { claimRun, getRun, saveRun, updateRun } = await import("./store.ts");

const waiting = (id) => ({
  id, mandateId: "m1", task: "test", status: "awaiting_approval",
  createdAt: "2026-11-03T10:00:00.000Z", updatedAt: "2026-11-03T10:00:00.000Z", steps: [],
});

test("two simultaneous approvals: exactly one claims the run", async () => {
  await saveRun(waiting("race"));
  let purchases = 0;
  const approve = () => claimRun("race", "awaiting_approval", (r) => { r.status = "running"; purchases += 1; });
  const results = await Promise.allSettled([approve(), approve()]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  const refused = results.find((r) => r.status === "rejected");
  assert.equal(refused.reason.message, "Run is not awaiting approval");
  assert.equal(purchases, 1);
  assert.equal((await getRun("race")).status, "running");
});

test("decline after approve is refused too", async () => {
  await saveRun(waiting("late"));
  await claimRun("late", "awaiting_approval", (r) => { r.status = "running"; });
  await assert.rejects(claimRun("late", "awaiting_approval", (r) => { r.status = "denied"; }), /not awaiting approval/);
  assert.equal((await getRun("late")).status, "running");
});

test("updateRun still works for unconditional patches", async () => {
  await saveRun(waiting("plain"));
  const r = await updateRun("plain", (x) => { x.summary = "ok"; });
  assert.equal(r.summary, "ok");
});

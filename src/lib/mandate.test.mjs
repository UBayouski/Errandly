// Revoking is final: PayPal can be connected only while a mandate is waiting for it.
// Runs against a temp DATA_DIR. Run: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "errandly-mandate-"));
const { activateMandate, connectBlockedReason, getMandate, saveMandate } = await import("./store.ts");

const mandate = (id, status, paypal = {}) => ({
  id,
  name: "Test mandate",
  description: "Office supplies under $50 a month",
  status,
  createdAt: new Date().toISOString(),
  paypal,
  policy: {
    currency: "USD", perTransactionMax: 50, periodMax: 50, period: "month", autoApproveBelow: 10,
    maxPurchasesPerPeriod: 4, allowedCategories: [], blockedCategories: [], allowedMerchants: [],
    blockedMerchants: [], expiresAt: null, notes: "",
  },
});

test("only a mandate waiting for PayPal can be connected", () => {
  assert.equal(connectBlockedReason({ status: "needs_paypal" }), null);
  assert.match(connectBlockedReason({ status: "revoked" }), /revoked/);
  assert.match(connectBlockedReason({ status: "expired" }), /expired/);
  assert.match(connectBlockedReason({ status: "active" }), /already connected/);
});

test("a waiting mandate is activated with its vault token", async () => {
  await saveMandate(mandate("waiting", "needs_paypal", { setupTokenId: "st-1" }));
  const { activated, mandate: m } = await activateMandate("waiting", { setupTokenId: "st-1", vaultId: "vault-1" });
  assert.equal(activated, true);
  assert.equal(m.status, "active");
  assert.equal((await getMandate("waiting")).paypal.vaultId, "vault-1");
});

test("a revoked mandate stays revoked when a PayPal return arrives", async () => {
  await saveMandate(mandate("revoked", "revoked", { setupTokenId: "st-old", vaultId: "vault-old" }));
  const { activated } = await activateMandate("revoked", { setupTokenId: "st-new", vaultId: "vault-new" });
  assert.equal(activated, false);
  const stored = await getMandate("revoked");
  assert.equal(stored.status, "revoked");
  assert.equal(stored.paypal.vaultId, "vault-old");
});

test("an active mandate keeps its original token", async () => {
  await saveMandate(mandate("active", "active", { setupTokenId: "st-a", vaultId: "vault-a" }));
  const { activated } = await activateMandate("active", { setupTokenId: "st-b", vaultId: "vault-b" });
  assert.equal(activated, false);
  assert.equal((await getMandate("active")).paypal.vaultId, "vault-a");
});

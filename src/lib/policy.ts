import type { Check, Decision, Mandate, Period, Proposal, Run } from "./types";

/**
 * The spend-policy engine. Deterministic and boring on purpose: the LLM
 * proposes, this code decides. Every check is recorded so the audit trail
 * shows exactly why a purchase ran, paused, or was refused.
 */

export function periodStart(period: Period, at = new Date()): Date {
  const d = new Date(at);
  d.setUTCHours(0, 0, 0, 0);
  if (period === "week") {
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - dow);
  } else if (period === "month") {
    d.setUTCDate(1);
  }
  return d;
}

export function spentInPeriod(mandate: Mandate, runs: Run[], at = new Date()) {
  const start = periodStart(mandate.policy.period, at).toISOString();
  const completed = runs.filter(
    (r) => r.mandateId === mandate.id && r.status === "completed" && r.payment && r.payment.at >= start,
  );
  const spent = completed.reduce((a, r) => a + (r.payment?.amount ?? 0), 0);
  return { spent: round(spent), count: completed.length, since: start };
}

const round = (n: number) => Math.round(n * 100) / 100;

function matches(list: string[], value: string): string | null {
  const v = value.toLowerCase();
  for (const item of list) {
    const needle = item.toLowerCase().trim();
    if (!needle) continue;
    if (v.includes(needle) || needle.includes(v)) return item;
  }
  return null;
}

function domainMatches(list: string[], domain: string): string | null {
  const d = domain.toLowerCase().replace(/^www\./, "");
  for (const item of list) {
    const needle = item.toLowerCase().trim().replace(/^www\./, "");
    if (!needle) continue;
    if (d === needle || d.endsWith(`.${needle}`) || needle.endsWith(`.${d}`)) return item;
  }
  return null;
}

export function evaluate(mandate: Mandate, proposal: Proposal, runs: Run[], at = new Date()): Decision {
  const p = mandate.policy;
  const checks: Check[] = [];
  const total = round(proposal.amount * proposal.quantity);
  const { spent, count } = spentInPeriod(mandate, runs, at);
  const money = (n: number) => `${n.toFixed(2)} ${p.currency}`;

  checks.push({
    name: "Mandate active",
    pass: mandate.status === "active",
    detail: mandate.status === "active" ? "Mandate is active" : `Mandate status is ${mandate.status}`,
  });
  checks.push({
    name: "PayPal connected",
    pass: Boolean(mandate.paypal.vaultId),
    detail: mandate.paypal.vaultId ? `Vaulted PayPal wallet ${mandate.paypal.payerEmail ?? ""}`.trim() : "No vaulted payment method",
  });
  const expired = p.expiresAt ? new Date(p.expiresAt).getTime() < at.getTime() : false;
  checks.push({
    name: "Not expired",
    pass: !expired,
    detail: p.expiresAt ? `Expires ${p.expiresAt.slice(0, 10)}` : "No expiry",
  });
  checks.push({
    name: "Currency",
    pass: proposal.currency.toUpperCase() === p.currency.toUpperCase(),
    detail: `Offer in ${proposal.currency}, mandate in ${p.currency}`,
  });
  checks.push({
    name: "Per-purchase cap",
    pass: total <= p.perTransactionMax,
    detail: `${money(total)} vs cap ${money(p.perTransactionMax)}`,
  });
  checks.push({
    name: `Spend this ${p.period}`,
    pass: round(spent + total) <= p.periodMax,
    detail: `${money(spent)} spent + ${money(total)} = ${money(round(spent + total))} vs cap ${money(p.periodMax)}`,
  });
  checks.push({
    name: `Purchases this ${p.period}`,
    pass: count < p.maxPurchasesPerPeriod,
    detail: `${count} of ${p.maxPurchasesPerPeriod} used`,
  });

  const blockedCat = matches(p.blockedCategories, proposal.category);
  checks.push({
    name: "Category not blocked",
    pass: !blockedCat,
    detail: blockedCat ? `"${proposal.category}" matches blocked "${blockedCat}"` : `"${proposal.category}" is not blocked`,
  });
  const allowedCat = p.allowedCategories.length === 0 ? "any" : matches(p.allowedCategories, proposal.category);
  checks.push({
    name: "Category allowed",
    pass: Boolean(allowedCat),
    detail:
      p.allowedCategories.length === 0
        ? "Any category allowed"
        : allowedCat
          ? `"${proposal.category}" matches allowed "${allowedCat}"`
          : `"${proposal.category}" not in allowed list (${p.allowedCategories.join(", ")})`,
  });
  const blockedMerchant = domainMatches(p.blockedMerchants, proposal.merchantDomain);
  checks.push({
    name: "Merchant not blocked",
    pass: !blockedMerchant,
    detail: blockedMerchant ? `${proposal.merchantDomain} is blocked` : `${proposal.merchantDomain} is not blocked`,
  });
  const allowedMerchant = p.allowedMerchants.length === 0 ? "any" : domainMatches(p.allowedMerchants, proposal.merchantDomain);
  checks.push({
    name: "Merchant allowed",
    pass: Boolean(allowedMerchant),
    detail:
      p.allowedMerchants.length === 0
        ? "Any merchant allowed"
        : allowedMerchant
          ? `${proposal.merchantDomain} is on the allow list`
          : `${proposal.merchantDomain} not in allow list (${p.allowedMerchants.join(", ")})`,
  });

  const failed = checks.filter((c) => !c.pass);
  const remainingAfter = round(p.periodMax - spent - total);

  if (failed.length) {
    return {
      outcome: "deny",
      reasons: failed.map((c) => `${c.name}: ${c.detail}`),
      checks,
      spentThisPeriod: spent,
      purchasesThisPeriod: count,
      remainingAfter,
    };
  }

  const needsApproval = total > p.autoApproveBelow;
  return {
    outcome: needsApproval ? "approval" : "auto",
    reasons: needsApproval
      ? [`${money(total)} is above the auto-approve threshold of ${money(p.autoApproveBelow)}`]
      : [`${money(total)} is within the auto-approve threshold of ${money(p.autoApproveBelow)}`],
    checks,
    spentThisPeriod: spent,
    purchasesThisPeriod: count,
    remainingAfter,
  };
}

export function describePolicy(p: Mandate["policy"]): string {
  const money = (n: number) => `${n.toFixed(2)} ${p.currency}`;
  const lines = [
    `Per purchase: up to ${money(p.perTransactionMax)}.`,
    `Per ${p.period}: up to ${money(p.periodMax)} and at most ${p.maxPurchasesPerPeriod} purchases.`,
    `Purchases at or below ${money(p.autoApproveBelow)} run without asking; above that the agent must pause for approval.`,
    p.allowedCategories.length ? `Allowed categories: ${p.allowedCategories.join(", ")}.` : "Any category allowed.",
    p.blockedCategories.length ? `Blocked categories: ${p.blockedCategories.join(", ")}.` : "",
    p.allowedMerchants.length ? `Allowed merchants: ${p.allowedMerchants.join(", ")}.` : "Any merchant allowed.",
    p.blockedMerchants.length ? `Blocked merchants: ${p.blockedMerchants.join(", ")}.` : "",
    p.expiresAt ? `Expires ${p.expiresAt.slice(0, 10)}.` : "No expiry.",
    p.notes ? `Notes: ${p.notes}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Verdict on a task's category alone, so an errand can be refused before any search. */
export function categoryVerdict(p: Mandate["policy"], category: string): { pass: boolean; reason: string } {
  const blocked = matches(p.blockedCategories, category);
  if (blocked) return { pass: false, reason: `"${category}" matches blocked category "${blocked}"` };
  if (p.allowedCategories.length && !matches(p.allowedCategories, category)) {
    return { pass: false, reason: `"${category}" is not in the allowed categories (${p.allowedCategories.join(", ")})` };
  }
  return { pass: true, reason: `"${category}" is allowed` };
}

"use client";

import Link from "next/link";
import type { MandateStatus, RunStatus } from "@/lib/types";

export function Shell({ sandbox, children }: { sandbox: boolean; children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="mark" aria-hidden>
            ✓
          </span>
          Errandly
        </Link>
        <span className={`pill ${sandbox ? "pill-amber" : "pill-green"}`}>{sandbox ? "PayPal sandbox" : "PayPal live"}</span>
      </header>
      <main className="main">{children}</main>
      <footer className="foot">Errandly: a shopping agent that spends only what you allow. Built for the PayPal AI Hackathon 2026.</footer>
    </div>
  );
}

export function money(n: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

const MANDATE_STATUS: Record<MandateStatus, { label: string; cls: string }> = {
  needs_paypal: { label: "Needs PayPal", cls: "pill-amber" },
  active: { label: "Active", cls: "pill-green" },
  revoked: { label: "Revoked", cls: "pill-gray" },
  expired: { label: "Expired", cls: "pill-gray" },
};

export function MandatePill({ status }: { status: MandateStatus }) {
  const s = MANDATE_STATUS[status];
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}

const RUN_STATUS: Record<RunStatus, { label: string; cls: string }> = {
  running: { label: "Running", cls: "pill-blue" },
  awaiting_approval: { label: "Needs approval", cls: "pill-amber" },
  completed: { label: "Completed", cls: "pill-green" },
  denied: { label: "Refused by policy", cls: "pill-gray" },
  no_match: { label: "Nothing found", cls: "pill-gray" },
  failed: { label: "Failed", cls: "pill-red" },
};

export function RunPill({ status }: { status: RunStatus }) {
  const s = RUN_STATUS[status];
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}

export function SpendMeter({ spent, max, currency, period, count, maxCount }: { spent: number; max: number; currency: string; period: string; count?: number; maxCount?: number }) {
  const pct = Math.min(100, Math.round((spent / Math.max(max, 0.01)) * 100));
  return (
    <div className="meter">
      <div className="meter-row">
        <span>
          <strong>{money(spent, currency)}</strong> of {money(max, currency)} this {period}
        </span>
        {count !== undefined && maxCount !== undefined && (
          <span className="muted">
            {count}/{maxCount} purchases
          </span>
        )}
      </div>
      <div className="bar">
        <div className={`bar-fill${pct >= 90 ? " hot" : ""}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

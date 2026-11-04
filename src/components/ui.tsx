"use client";

import Link from "next/link";
import type { MandateStatus, RunStatus } from "@/lib/types";

export function Shell({ sandbox, children, modelLabel }: { sandbox: boolean; children: React.ReactNode; modelLabel?: string }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="mark" aria-hidden>
            <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 22h38a3 3 0 0 1 3 3.3l-3 30a4 4 0 0 1-4 3.7H17a4 4 0 0 1-4-3.7l-3-30A3 3 0 0 1 13 22z" fill="currentColor" /><path d="M22 22v-5a10 10 0 0 1 20 0v5" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" /><path d="M23 38l6.5 6.5L42 31" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          Errandly
        </Link>
        <div className="topbar-end"><nav aria-label="Main navigation"><Link href="/#mandates">Your mandates</Link></nav><span className={`pill ${sandbox ? "pill-amber" : "pill-green"}`}>{sandbox ? "PayPal sandbox" : "PayPal live"}</span></div>
      </header>
      <main className="main">{children}</main>
      <footer className="foot"><span>Errandly. Your permission, every purchase.</span><span>{modelLabel ? `${modelLabel} with the PayPal Agent Toolkit` : "Built with the PayPal Agent Toolkit"}</span></footer>
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
  denied: { label: "Refused by policy", cls: "pill-rose" },
  no_match: { label: "Nothing found", cls: "pill-gray" },
  failed: { label: "Failed", cls: "pill-red" },
};

export function RunPill({ status, declined = false }: { status: RunStatus; declined?: boolean }) {
  const s = RUN_STATUS[status];
  const byOwner = status === "denied" && declined;
  return <span className={`pill ${byOwner ? "pill-gray" : s.cls}`}>{byOwner ? "Declined by you" : s.label}</span>;
}

export function SpendMeter({ spent, max, currency, period, count, maxCount }: { spent: number; max: number; currency: string; period: string; count?: number; maxCount?: number }) {
  const pct = Math.min(100, Math.round((spent / Math.max(max, 0.01)) * 100));
  return (
    <div className="meter">
      <div className="meter-row">
        <span>
          <strong>{money(Math.max(0, max - spent), currency)}</strong> left this {period}
        </span>
        <span className="muted">{money(spent, currency)} of {money(max, currency)} used</span>
      </div>
        {count !== undefined && maxCount !== undefined && (
          <span className="muted meter-count">
            {count}/{maxCount} purchases
          </span>
        )}
      <div className="bar" role="progressbar" aria-label={`Budget used this ${period}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, pct)} aria-valuetext={`${money(spent, currency)} of ${money(max, currency)} used`}>
        <div className={`bar-fill${pct >= 90 ? " hot" : ""}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

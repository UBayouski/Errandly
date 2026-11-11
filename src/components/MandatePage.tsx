"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mandate, Run, RunStep } from "@/lib/types";
import { MandatePill, RunPill, Shell, SpendMeter, money } from "./ui";

type Payload = { mandate: Mandate; runs: Run[]; spend: { spent: number; count: number; since: string } };

const TASK_EXAMPLES = ["Order a dozen black ballpoint pens", "We're out of copy paper, get 5 reams", "Buy a USB-C cable for the new laptop", "Get a bag of whole-bean coffee"];

const HISTORY_FILTERS = [
  { id: "all", label: "All", statuses: [], emptyTitle: "A little more off your list, soon.", emptyText: "Your errands will appear here with their offers, spending checks, and payment results." },
  { id: "approval", label: "Needs approval", statuses: ["awaiting_approval"], emptyTitle: "No approvals waiting.", emptyText: "Errands that need your decision will appear here." },
  { id: "completed", label: "Completed", statuses: ["completed"], emptyTitle: "No completed errands yet.", emptyText: "Completed errands will appear here with their payment results and receipts." },
  { id: "unsuccessful", label: "Unsuccessful", statuses: ["denied", "no_match", "failed"], emptyTitle: "No unsuccessful errands.", emptyText: "Requests refused by your rules, declined by you, unsuccessful searches, and failed errands will appear here." },
] as const;
type HistoryFilter = (typeof HISTORY_FILTERS)[number]["id"];
const LIVE_STATUSES: readonly Run["status"][] = ["running", "awaiting_approval"];
const isLive = (run: Run) => LIVE_STATUSES.includes(run.status);

export function MandatePage({ id, sandbox, modelLabel }: { id: string; sandbox: boolean; modelLabel?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [task, setTask] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyNotice, setHistoryNotice] = useState<{ kind: "notice" | "error"; text: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taskInput = useRef<HTMLInputElement>(null);

  const fetchMandate = useCallback(async (): Promise<Payload> => {
    const res = await fetch(`/api/mandates/${id}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Mandate not found");
    return (await res.json()) as Payload;
  }, [id]);

  const load = useCallback(async () => {
    try {
      setData(await fetchMandate());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [fetchMandate]);

  useEffect(() => {
    let alive = true;
    fetchMandate()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      alive = false;
    };
  }, [fetchMandate]);

  // PayPal redirects back with a query flag; derive the banner from it.
  const paramNotice = useMemo(() => {
    if (search.get("connected")) return { kind: "notice" as const, text: "PayPal connected. The wallet is vaulted and the mandate is active." };
    if (search.get("cancelled")) return { kind: "notice" as const, text: "PayPal consent was cancelled. The mandate is not active." };
    if (search.get("error")) return { kind: "error" as const, text: `PayPal consent failed: ${search.get("error")}` };
    return null;
  }, [search]);
  const shownNotice = notice ?? (!dismissed && paramNotice?.kind === "notice" ? paramNotice.text : null);
  const shownError = error ?? (!dismissed && paramNotice?.kind === "error" ? paramNotice.text : null);
  const dismiss = () => {
    setNotice(null);
    setDismissed(true);
    if (search.toString()) router.replace(`/mandates/${id}`);
  };

  // Poll while any run is in flight.
  useEffect(() => {
    const running = data?.runs.some((r) => r.status === "running");
    const waiting = data?.runs.some((r) => r.status === "awaiting_approval");
    if (!running && !waiting) return;
    timer.current = setTimeout(() => void load(), running ? 1500 : 8000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [data, load]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mandates/${id}/connect`, { method: "POST" });
      const json = (await res.json()) as { approveUrl?: string; error?: string };
      if (!res.ok || !json.approveUrl) throw new Error(json.error ?? `HTTP ${res.status}`);
      window.location.href = json.approveUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start PayPal consent");
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!confirm("Revoke this mandate? The vaulted PayPal payment token will be deleted and the agent can never charge it again.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/mandates/${id}`, { method: "DELETE" });
      const json = (await res.json()) as { tokenDeleted?: boolean; tokenError?: string };
      setNotice(json.tokenDeleted ? "Mandate revoked and PayPal token deleted." : `Mandate revoked.${json.tokenError ? ` Token delete failed: ${json.tokenError}` : ""}`);
      await load();
    } catch {
      setError("Could not reach Errandly to revoke the mandate. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const run = async (t?: string) => {
    const text = (t ?? task).trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mandateId: id, task: text }),
      });
      const json = (await res.json()) as { run?: Run; error?: string };
      if (!res.ok || !json.run) throw new Error(json.error ?? `HTTP ${res.status}`);
      setTask("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the errand");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (runId: string, approved: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/runs/${runId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved }),
      });
      const json = (await res.json()) as { run?: Run; error?: string };
      if (!res.ok || !json.run) {
        setHistoryNotice({ kind: "error", text: json.error ?? `HTTP ${res.status}` });
      } else {
        const outcome = json.run;
        setHistoryNotice({ kind: outcome.status === "completed" || (outcome.status === "denied" && !approved) ? "notice" : "error", text: outcome.summary ?? "Decision recorded." });
        const current = HISTORY_FILTERS.find((filter) => filter.id === historyFilter)!;
        if (current.id !== "all" && !(current.statuses as readonly Run["status"][]).includes(outcome.status)) setHistoryFilter("all");
      }
      await load();
    } catch {
      setHistoryNotice({ kind: "error", text: "Could not reach Errandly to record your decision. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Shell sandbox={sandbox} modelLabel={modelLabel}>
        {shownError ? <div className="error" role="alert">{shownError}</div> : <div className="page-skeleton" aria-label="Loading mandate" aria-busy="true"><div className="skeleton-title" /><div className="two-col mandate-workspace"><div className="errand-entry"><div className="card mandate-skeleton" aria-hidden><div /><div /><div /></div></div><div className="stack mandate-sidebar"><div className="card mandate-skeleton" aria-hidden><div /><div /><div /></div><div className="card mandate-skeleton short" aria-hidden><div /><div /></div></div></div></div>}
      </Shell>
    );
  }

  const { mandate: m, runs, spend } = data;
  const p = m.policy;
  const purchasesLeft = Math.max(0, p.maxPurchasesPerPeriod - spend.count);
  const orderedRuns = [...runs].sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.createdAt.localeCompare(a.createdAt));
  const historyViews = HISTORY_FILTERS.map((filter) => ({
    ...filter,
    runs: orderedRuns.filter((run) => filter.id === "all" || (filter.statuses as readonly Run["status"][]).includes(run.status)),
  }));
  const historyView = historyViews.find((filter) => filter.id === historyFilter)!;

  return (
    <Shell sandbox={sandbox} modelLabel={modelLabel}>
      <div className="crumbs">
        <Link href="/">← All mandates</Link>
      </div>
      <div className="row between wrap mandate-title-row">
        <div><h1 className="title">{m.name}</h1></div>
        <div className="row">
          <MandatePill status={m.status} />
          {m.status !== "revoked" && (
            <button className="ghost danger" onClick={() => void revoke()} disabled={busy}>
              Revoke mandate
            </button>
          )}
        </div>
      </div>
      {shownNotice && (
        <div className="notice banner" role="status">
          <span>{shownNotice}</span>
          <button type="button" className="dismiss" aria-label="Dismiss" onClick={dismiss}>×</button>
        </div>
      )}
      {shownError && (
        <div className="error banner" role="alert">
          <span>{shownError}</span>
          <button type="button" className="dismiss" aria-label="Dismiss" onClick={dismiss}>×</button>
        </div>
      )}

      <div className="two-col mandate-workspace">
        <div className="errand-entry">
          <section className="card errand-composer">
            <h2>{m.status === "active" ? "What do you need?" : m.status === "needs_paypal" ? "One connection. Your rules." : "This mandate is no longer active"}</h2>
            {m.status === "needs_paypal" ? <div className="connect-prompt"><p>Review your spending rules, then connect PayPal. Errandly can pay automatically up to {money(p.autoApproveBelow, p.currency)}, asks above that amount, and refuses purchases outside your rules.</p><button className="paypal" onClick={() => void connect()} disabled={busy}>{busy ? "Opening PayPal…" : "Connect PayPal"}</button>{sandbox && <p className="small muted">Use a PayPal sandbox personal account for this demo.</p>}</div> : m.status !== "active" ? <p className="muted">{m.status === "revoked" ? "This permission has been revoked." : "This permission has expired."} <Link href="/#new-mandate">Create a new mandate</Link> to run more errands.</p> : <>
            <p className="form-description">Describe the item and quantity. Errandly will find an offer and check it against your spending rules.</p>
            <form onSubmit={(event) => { event.preventDefault(); void run(); }}>
            <label className="input-label" htmlFor="errand-task">Shopping request</label>
            <div className="row errand-input-row">
              <input
                ref={taskInput}
                id="errand-task"
                aria-describedby="errand-budget"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="e.g. Get five reams of A4 copy paper"
                disabled={m.status !== "active" || busy}
              />
              <button className="primary" type="submit" disabled={busy || !task.trim()}>
                {busy ? "Starting…" : "Run errand"}<span aria-hidden>→</span>
              </button>
            </div>
            <p className="errand-budget" id="errand-budget">
              <strong>{money(Math.max(0, p.periodMax - spend.spent), p.currency)} available</strong>
              <span>{purchasesLeft} {purchasesLeft === 1 ? "purchase" : "purchases"} left this {p.period}</span>
            </p>
            </form>
            <div className="examples task-examples">
              <span className="examples-label">Start with an idea:</span>
              {TASK_EXAMPLES.map((t) => (
                <button key={t} className={`chip${task === t ? " active" : ""}`} aria-pressed={task === t} disabled={busy} onClick={() => { setTask(t); taskInput.current?.focus(); }}>
                  {t}
                </button>
              ))}
            </div>
            <div className="execution-note"><span className="status-dot" aria-hidden />Up to {money(p.autoApproveBelow, p.currency)} can be paid automatically. Higher amounts need your approval; your purchase cap is {money(p.perTransactionMax, p.currency)}.</div>
            </>}
          </section>

        </div>

        <div className="stack mandate-sidebar">
          <section className="card policy-card">
            <h2>Spending rules</h2>
            <SpendMeter spent={spend.spent} max={p.periodMax} currency={p.currency} period={p.period} count={spend.count} maxCount={p.maxPurchasesPerPeriod} />
            <ul className="policy">
              <li>
                <span>Per purchase</span>
                <strong>{money(p.perTransactionMax, p.currency)}</strong>
              </li>
              <li>
                <span>Per {p.period}</span>
                <strong>
                  {money(p.periodMax, p.currency)} · max {p.maxPurchasesPerPeriod} orders
                </strong>
              </li>
              <li>
                <span>Auto-approve up to</span>
                <strong>{money(p.autoApproveBelow, p.currency)}</strong>
              </li>
              <li>
                <span>Allowed categories</span>
                <strong>{p.allowedCategories.length ? p.allowedCategories.join(", ") : "any"}</strong>
              </li>
              {p.blockedCategories.length > 0 && (
                <li className="blocked">
                  <span>Blocked categories</span>
                  <strong>{p.blockedCategories.join(", ")}</strong>
                </li>
              )}
              <li>
                <span>Allowed merchants</span>
                <strong>{p.allowedMerchants.length ? p.allowedMerchants.join(", ") : "any"}</strong>
              </li>
              {p.blockedMerchants.length > 0 && (
                <li className="blocked">
                  <span>Blocked merchants</span>
                  <strong>{p.blockedMerchants.join(", ")}</strong>
                </li>
              )}
              <li>
                <span>Expires</span>
                <strong>{p.expiresAt ? p.expiresAt.slice(0, 10) : "never"}</strong>
              </li>
              {p.notes && (
                <li>
                  <span>Notes</span>
                  <strong>{p.notes}</strong>
                </li>
              )}
            </ul>
            <details className="original-instruction"><summary>Your original instruction</summary><blockquote>{m.description}</blockquote></details>
          </section>

          <section className="card connection-card">
            <div className="section-kicker">Payment permission</div>
            <h2>PayPal wallet</h2>
            {m.status === "revoked" ? (
                <p className="muted">This mandate is revoked and can no longer make purchases.</p>
            ) : m.paypal.vaultId ? (
              <>
                <p>
                  <span className="status-dot" aria-hidden /> Connected{m.paypal.payerEmail ? <> as <strong>{m.paypal.payerEmail}</strong></> : " to this mandate"}.
                </p>
                <p className="small muted">Purchases within your automatic approval limit can be paid without another checkout. Revoke the mandate to remove its saved payment permission.</p>
                <details className="connection-details"><summary>Connection details</summary><p className="small muted">Payment token <code>{m.paypal.vaultId}</code><br />Permission given {m.paypal.approvedAt?.slice(0, 10) || "previously"}.</p></details>
              </>
            ) : (
              <>
                <p className="muted">Not connected yet. Your spending rules are ready to review before you give PayPal permission.</p>
              </>
            )}
          </section>
        </div>

        <section className="stack errand-history" aria-label="Errand history">
          <div className="section-head activity-head"><h2>Errand history</h2><span className="small muted" role="status">{historyFilter === "all" ? runs.length : `${historyView.runs.length} of ${runs.length}`} {runs.length === 1 ? "errand" : "errands"}</span></div>
          {historyNotice && (
            <div className={`${historyNotice.kind} banner`} role={historyNotice.kind === "error" ? "alert" : "status"}>
              <span>{historyNotice.text}</span>
              <button type="button" className="dismiss" aria-label="Dismiss" onClick={() => setHistoryNotice(null)}>×</button>
            </div>
          )}
          <div className="history-filters" role="group" aria-label="Filter errand history">
            {historyViews.map((filter) => <button key={filter.id} type="button" className={`chip${historyFilter === filter.id ? " active" : ""}`} aria-pressed={historyFilter === filter.id} onClick={() => setHistoryFilter(filter.id)}>{filter.label}<span className="history-filter-count">{filter.runs.length}</span></button>)}
          </div>
          {historyView.runs.length === 0 && <div className="empty-state"><h3>{historyView.emptyTitle}</h3><p>{historyView.emptyText}</p></div>}
          {historyView.runs.map((r) => (
            <RunCard key={r.id} run={r} currency={p.currency} remaining={p.periodMax - spend.spent} onDecide={decide} busy={busy} onRevise={m.status === "active" ? (request) => { setTask(request); taskInput.current?.focus(); } : undefined} />
          ))}
        </section>
      </div>
    </Shell>
  );
}

const STEP_PATH: Record<RunStep["type"], string> = {
  thought: "M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z",
  search: "M7 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm2.8 6.8L13 13",
  policy: "M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4l5-2Zm-2 6l1.5 1.5L10.5 6.5",
  payment: "M2.5 5.5h11M2.5 4.5h11v7h-11v-7Zm2.5 5h3",
  approval: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 2.5v3l2 1.5",
  error: "M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm0 2.5v3.5M8 11h.01",
  summary: "M3.5 8.5l3 3 6-7",
  fulfillment: "M2.5 8h11M9.5 4.5 13 8l-3.5 3.5",
};

function StepIcon({ type }: { type: RunStep["type"] }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={STEP_PATH[type]} />
    </svg>
  );
}

const dateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" });

function RunCard({ run, currency, remaining, onDecide, onRevise, busy }: { run: Run; currency: string; remaining: number; onDecide: (id: string, approved: boolean) => Promise<void>; onRevise?: (request: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(run.status === "awaiting_approval" || run.status === "running");
  const prop = run.proposal;
  const dec = run.decision;
  const completed = run.status === "completed";
  const total = prop ? prop.amount * prop.quantity : 0;
  const shortfall = Math.round((total - remaining) * 100) / 100;
  return (
    <article className={`card run run-${run.status}`}>
      <div className="run-head">
        <div className="run-head-copy">
          <h3 className="run-task">
            <button type="button" className="run-toggle" aria-expanded={open} aria-controls={`run-details-${run.id}`} onClick={() => setOpen((o) => !o)}>{run.task}</button>
          </h3>
          <span className="small muted">{completed ? `Completed ${dateTime(run.updatedAt)}` : dateTime(run.createdAt)}</span>
        </div>
        <span className="row run-status"><RunPill status={run.status} declined={run.steps.some((step) => step.type === "approval" && step.title === "Owner declined")} /><span className="run-chevron" aria-hidden>{open ? "−" : "+"}</span></span>
      </div>

      {!completed && run.summary && <p className="summary">{run.summary}</p>}
      {run.status === "no_match" && onRevise && (
        <div className="run-revise"><button type="button" className="ghost" disabled={busy} onClick={() => onRevise(run.task)}>Revise request</button></div>
      )}
      {run.status === "running" && !run.summary && <p className="muted">Working… {run.steps[run.steps.length - 1]?.title}</p>}

      {prop && (
        <div className="proposal">
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary retailer hosts, no optimizer */}
          {prop.imageUrl && <img src={prop.imageUrl} alt="" />}
          <div className="proposal-copy">
            <div className="prop-title">{prop.title}</div>
            <div className="small muted">
              {prop.merchantDomain} · qty {prop.quantity} · {prop.source === "demo" ? "demo catalog" : "Channel3"}
            </div>
            <div className="prop-price">{money(completed && run.payment ? run.payment.amount : prop.amount * prop.quantity, completed && run.payment ? run.payment.currency : prop.currency)} <span className="small muted">{completed && run.payment ? "paid with PayPal" : "total"}</span></div>
            <a className="small" href={prop.offerUrl} target="_blank" rel="noreferrer">
              View offer ↗
            </a>
          </div>
        </div>
      )}

      {run.status === "awaiting_approval" && dec && (
        <div className="approval">
          <div>
            <h4>Your approval is needed</h4><p>{dec.reasons[0]}</p>{shortfall > 0 ? <div className="approval-balance over"><span>Over budget by</span><strong>{money(shortfall, currency)}</strong></div> : <div className="approval-balance"><span>Budget left after this purchase</span><strong>{money(remaining - total, currency)}</strong></div>}
          </div>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => void onDecide(run.id, true)}>
              Approve and pay{prop ? ` ${money(total, prop.currency)}` : ""}
            </button>
            <button className="ghost" disabled={busy} onClick={() => void onDecide(run.id, false)}>
              Decline
            </button>
          </div>
        </div>
      )}

      {completed && <>
        {!prop && run.payment && <p className="completed-payment">Paid {money(run.payment.amount, run.payment.currency)} with PayPal</p>}
        {run.payment && <p className="small muted completed-fulfillment">Retailer hand-off is simulated in this demo.</p>}
      </>}

      <div id={`run-details-${run.id}`} hidden={!open}>
      {completed && run.summary && <p className="summary">{run.summary}</p>}
      {run.payment && (
        <div className="payment">
          {completed ? <strong>PayPal receipt</strong> : <><strong>Paid {money(run.payment.amount, run.payment.currency)}</strong><span> with PayPal</span><p className="small">Retailer hand-off is simulated in this demo.</p></>}
          {completed ? <p className="payment-proof">Order <code>{run.payment.orderId}</code>{run.payment.captureId && <><br />Capture <code>{run.payment.captureId}</code></>}</p> : <details className="payment-proof"><summary>PayPal receipt</summary><p>Order <code>{run.payment.orderId}</code>{run.payment.captureId && <><br />Capture <code>{run.payment.captureId}</code></>}</p></details>}
        </div>
      )}

      {open && (
        <div className="timeline">
          <div className="section-kicker">How this errand unfolded</div>
          {run.steps.map((s, i) => (
            <div key={i} className={`step step-${s.type}`}>
              <span className="icon"><StepIcon type={s.type} /></span>
              <div>
                <div className="step-title">{s.title}</div>
                {s.detail && <div className="small muted">{s.detail}</div>}
                {s.type === "policy" && Array.isArray((s.data as { checks?: unknown[] } | undefined)?.checks) && (
                  <ul className="checks">
                    {((s.data as { checks: { name: string; pass: boolean; detail: string }[] }).checks).map((c) => (
                      <li key={c.name} className={c.pass ? "pass" : "fail"}>
                        <span>{c.pass ? "✓" : "✕"}</span> {c.name}: <span className="muted">{c.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <span className="small muted time">{time(s.at)}</span>
            </div>
          ))}
        </div>
      )}
      </div>
    </article>
  );
}

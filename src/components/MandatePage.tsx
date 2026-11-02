"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Mandate, Run, RunStep } from "@/lib/types";
import { MandatePill, RunPill, Shell, SpendMeter, money } from "./ui";

type Payload = { mandate: Mandate; runs: Run[]; spend: { spent: number; count: number; since: string } };

const TASK_EXAMPLES = ["Order a dozen black ballpoint pens", "We're out of copy paper, get 5 reams", "Buy a USB-C cable for the new laptop", "Get a bag of whole-bean coffee"];

export function MandatePage({ id, sandbox }: { id: string; sandbox: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const live = data?.runs.some((r) => r.status === "running");
    if (!live) return;
    timer.current = setTimeout(() => void load(), 1500);
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
      const json = (await res.json()) as { error?: string };
      if (!res.ok) setError(json.error ?? `HTTP ${res.status}`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Shell sandbox={sandbox}>
        {shownError ? <div className="error">{shownError}</div> : <div className="muted">Loading…</div>}
      </Shell>
    );
  }

  const { mandate: m, runs, spend } = data;
  const p = m.policy;

  return (
    <Shell sandbox={sandbox}>
      <div className="crumbs">
        <Link href="/">← All mandates</Link>
      </div>
      <div className="row between wrap">
        <h1 className="title">{m.name}</h1>
        <div className="row">
          <MandatePill status={m.status} />
          {m.status !== "revoked" && (
            <button className="ghost danger" onClick={() => void revoke()} disabled={busy}>
              Revoke
            </button>
          )}
        </div>
      </div>
      {shownNotice && (
        <div className="notice" onClick={dismiss} role="status">
          {shownNotice}
        </div>
      )}
      {shownError && (
        <div className="error" onClick={dismiss}>
          {shownError}
        </div>
      )}

      <div className="two-col">
        <div className="stack">
          <section className="card">
            <h2>Mandate</h2>
            <blockquote>{m.description}</blockquote>
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
                <span>Categories</span>
                <strong>
                  {p.allowedCategories.length ? p.allowedCategories.join(", ") : "any"}
                  {p.blockedCategories.length ? <span className="muted"> · blocked: {p.blockedCategories.join(", ")}</span> : null}
                </strong>
              </li>
              <li>
                <span>Merchants</span>
                <strong>
                  {p.allowedMerchants.length ? p.allowedMerchants.join(", ") : "any"}
                  {p.blockedMerchants.length ? <span className="muted"> · blocked: {p.blockedMerchants.join(", ")}</span> : null}
                </strong>
              </li>
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
            <SpendMeter spent={spend.spent} max={p.periodMax} currency={p.currency} period={p.period} count={spend.count} maxCount={p.maxPurchasesPerPeriod} />
          </section>

          <section className="card">
            <h2>Payment</h2>
            {m.paypal.vaultId ? (
              <>
                <p>
                  PayPal wallet <strong>{m.paypal.payerEmail ?? "connected"}</strong> is vaulted for this mandate.
                </p>
                <p className="small muted">
                  Payment token {m.paypal.vaultId} · consented {m.paypal.approvedAt?.slice(0, 10)}. Charges are merchant-initiated against this token; no
                  checkout screen appears. Revoking the mandate deletes the token at PayPal.
                </p>
              </>
            ) : m.status === "revoked" ? (
              <p className="muted">Token deleted. This mandate can no longer pay.</p>
            ) : (
              <>
                <p>Approve this mandate once with PayPal. Your wallet is saved as a payment token scoped to this app, and Errandly can only charge it within the policy above.</p>
                <button className="paypal" onClick={() => void connect()} disabled={busy}>
                  {busy ? "Opening PayPal…" : "Connect PayPal"}
                </button>
                {sandbox && <p className="small muted">Sandbox: sign in with a sandbox personal account from your PayPal developer dashboard.</p>}
              </>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="card">
            <h2>Run an errand</h2>
            <div className="row">
              <input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void run()}
                placeholder={m.status === "active" ? "What do you need?" : "Connect PayPal to run errands"}
                disabled={m.status !== "active" || busy}
              />
              <button className="primary" onClick={() => void run()} disabled={m.status !== "active" || busy || !task.trim()}>
                Go
              </button>
            </div>
            <div className="examples">
              {TASK_EXAMPLES.map((t) => (
                <button key={t} className="chip" disabled={m.status !== "active" || busy} onClick={() => void run(t)}>
                  {t}
                </button>
              ))}
            </div>
          </section>

          {runs.length === 0 && <div className="muted">No errands yet.</div>}
          {runs.map((r) => (
            <RunCard key={r.id} run={r} currency={p.currency} onDecide={decide} busy={busy} />
          ))}
        </div>
      </div>
    </Shell>
  );
}

const STEP_ICON: Record<RunStep["type"], string> = {
  thought: "◦",
  search: "⌕",
  policy: "⚖",
  payment: "$",
  approval: "✋",
  error: "!",
  summary: "✎",
  fulfillment: "⇢",
};

function RunCard({ run, currency, onDecide, busy }: { run: Run; currency: string; onDecide: (id: string, approved: boolean) => Promise<void>; busy: boolean }) {
  const [open, setOpen] = useState(run.status === "awaiting_approval" || run.status === "running");
  const prop = run.proposal;
  const dec = run.decision;
  return (
    <article className={`card run run-${run.status}`}>
      <button className="run-head" onClick={() => setOpen((o) => !o)}>
        <div>
          <div className="run-task">{run.task}</div>
          <div className="small muted">{new Date(run.createdAt).toLocaleString()}</div>
        </div>
        <RunPill status={run.status} />
      </button>

      {run.summary && <p className="summary">{run.summary}</p>}
      {run.status === "running" && !run.summary && <p className="muted">Working… {run.steps[run.steps.length - 1]?.title}</p>}

      {prop && (
        <div className="proposal">
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary retailer hosts, no optimizer */}
          {prop.imageUrl ? <img src={prop.imageUrl} alt="" /> : <div className="img-ph" />}
          <div>
            <div className="prop-title">{prop.title}</div>
            <div className="small muted">
              {prop.merchantDomain} · qty {prop.quantity} · {prop.source === "demo" ? "demo catalog" : "Channel3"}
            </div>
            <div className="prop-price">{money(prop.amount * prop.quantity, prop.currency)}</div>
            <a className="small" href={prop.offerUrl} target="_blank" rel="noreferrer">
              View offer ↗
            </a>
          </div>
        </div>
      )}

      {run.status === "awaiting_approval" && dec && (
        <div className="approval">
          <div>
            <strong>Approve this purchase?</strong> {dec.reasons[0]} Remaining after: {money(dec.remainingAfter, currency)}.
          </div>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => void onDecide(run.id, true)}>
              Approve and pay
            </button>
            <button className="ghost" disabled={busy} onClick={() => void onDecide(run.id, false)}>
              Decline
            </button>
          </div>
        </div>
      )}

      {run.payment && (
        <div className="payment">
          Paid {money(run.payment.amount, run.payment.currency)} · PayPal order <code>{run.payment.orderId}</code>
          {run.payment.captureId && (
            <>
              {" "}
              · capture <code>{run.payment.captureId}</code>
            </>
          )}
        </div>
      )}

      {open && (
        <div className="timeline">
          {run.steps.map((s, i) => (
            <div key={i} className={`step step-${s.type}`}>
              <span className="icon">{STEP_ICON[s.type]}</span>
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
              <span className="small muted time">{new Date(s.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Mandate } from "@/lib/types";
import { MandatePill, Shell, SpendMeter, money } from "./ui";

type MandateRow = Mandate & { spend: { spent: number; count: number }; runCount: number; pending: number };

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "Office supplies",
    text: "Keep the home office stocked: printer ink, paper, pens. Up to $60 per purchase and $150 a month, only from Staples or Office Depot, no more than 4 orders a month. Anything over $40 ask me first.",
  },
  {
    label: "Weekly groceries",
    text: "Weekly coffee and household basics. Up to $45 per order, $120 a week. Never alcohol, never gift cards. Auto-approve under $30.",
  },
  {
    label: "School supplies",
    text: "Buy my kid's school supplies this month: max $35 per item, $200 total, ask me for anything above $25. Expires at the end of the month.",
  },
];

export function Home({ sandbox, liveCatalog, modelLabel }: { sandbox: boolean; liveCatalog: boolean; modelLabel: string }) {
  const router = useRouter();
  const [mandates, setMandates] = useState<MandateRow[] | null>(null);
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState(false);
  const [listAttempt, setListAttempt] = useState(0);
  const instruction = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/mandates", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Could not load mandates");
        return res.json() as Promise<{ mandates: MandateRow[] }>;
      })
      .then((json) => {
        if (alive) setMandates(json.mandates);
      })
      .catch(() => {
        if (alive) setListError(true);
      });
    return () => {
      alive = false;
    };
  }, [listAttempt]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/mandates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json()) as { mandate?: Mandate; error?: string };
      if (!res.ok || !json.mandate) throw new Error(json.error ?? `HTTP ${res.status}`);
      router.push(`/mandates/${json.mandate.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create mandate");
      setCreating(false);
    }
  };

  return (
    <Shell sandbox={sandbox} modelLabel={modelLabel}>
      <div className="home-intro">
        <section className="hero">
          <h1>Your errands.<br /><em>Your spending rules.</em></h1>
          <p className="lede">Tell Errandly what to buy, where to shop, and when to ask. It finds an offer and checks every purchase against your rules.</p>
          <ol className="steps">
            <li><span className="step-number" aria-hidden>01</span><div><strong>Set your limits</strong><span>A budget, your shops, and the purchases you allow.</span></div></li>
            <li><span className="step-number" aria-hidden>02</span><div><strong>Connect PayPal</strong><span>Give permission once. Revoke it whenever you need to.</span></div></li>
            <li><span className="step-number" aria-hidden>03</span><div><strong>Hand off an errand</strong><span>Within your limit, it pays. Above your threshold, it asks. Outside your rules, it stops.</span></div></li>
          </ol>
          <div className="catalog-note"><span className="status-dot" aria-hidden />{liveCatalog ? "Live product search with Channel3" : "Demo product catalog"}</div>
        </section>

        <form id="new-mandate" className="card new-mandate" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <h2>What should Errandly handle?</h2>
        <p className="form-description">A mandate is your shopping permission. Describe yours in a sentence or two.</p>
        <label className="input-label" htmlFor="mandate-instruction">Your instructions</label>
        <textarea
          ref={instruction}
          id="mandate-instruction"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="e.g. Keep the home office stocked with paper and pens. Up to $60 per purchase, $150 a month, only Staples or Office Depot. Ask me before anything over $40."
        />
        <div className="examples">
          <span className="examples-label">Try an example:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex.label} className={`chip${text === ex.text ? " active" : ""}`} aria-pressed={text === ex.text} onClick={() => { setText(ex.text); instruction.current?.focus(); }} type="button">
              {ex.label}
            </button>
          ))}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="composer-footer">
          <button className="primary" type="submit" disabled={creating || text.trim().length < 10}>
            {creating ? "Preparing your rules…" : "Review spending rules"}<span aria-hidden>→</span>
          </button>
          <p className="small muted">You’ll review the rules before connecting PayPal. No purchase is made here.</p>
        </div>
        </form>
      </div>

      <section id="mandates" className="mandates-section" aria-labelledby="mandates-heading">
        <div className="section-head"><h2 id="mandates-heading">Your mandates {mandates && <span className="section-count">{mandates.length}</span>}</h2></div>
        {listError ? <div className="empty-state"><h3>Couldn’t load your mandates</h3><p>Your saved permissions haven’t changed.</p><button onClick={() => { setListError(false); setListAttempt((attempt) => attempt + 1); }}>Try again</button></div> : mandates === null && <div className="mandate-grid" aria-label="Loading mandates">{[0, 1, 2].map((i) => <div className="card mandate-skeleton" key={i} aria-hidden><div /><div /><div /></div>)}</div>}
        {mandates?.length === 0 && <div className="empty-state"><h3>Your first mandate starts above.</h3><p>Choose an example or write your own shopping rules.</p><a className="text-link" href="#new-mandate">Set up a mandate <span aria-hidden>→</span></a></div>}
        <div className="mandate-grid">
          {mandates?.map((m) => (
            <Link key={m.id} href={`/mandates/${m.id}`} className="card mandate-card">
              <div className="row between">
                <h3>{m.name}</h3>
                <MandatePill status={m.status} />
              </div>
              <p className="muted clamp">{m.description}</p>
              <div className="mandate-limits"><div><span>Per purchase</span><strong>{money(m.policy.perTransactionMax, m.policy.currency)}</strong></div><div><span>Ask above</span><strong>{money(m.policy.autoApproveBelow, m.policy.currency)}</strong></div></div>
              <SpendMeter spent={m.spend.spent} max={m.policy.periodMax} currency={m.policy.currency} period={m.policy.period} />
              <div className="row between small muted">
                <span>{m.runCount} {m.runCount === 1 ? "errand" : "errands"}</span>
                {m.pending > 0 ? <span className="pill pill-amber">{m.pending} awaiting approval</span> : <span className="mandate-open">View mandate <span aria-hidden>→</span></span>}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </Shell>
  );
}

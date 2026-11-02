"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Mandate } from "@/lib/types";
import { MandatePill, Shell, SpendMeter } from "./ui";

type MandateRow = Mandate & { spend: { spent: number; count: number }; runCount: number; pending: number };

const EXAMPLES = [
  "Keep the home office stocked: printer ink, paper, pens. Up to $60 per purchase and $150 a month, only from Staples or Office Depot, no more than 4 orders a month. Anything over $40 ask me first.",
  "Weekly coffee and household basics. Up to $45 per order, $120 a week. Never alcohol, never gift cards. Auto-approve under $30.",
  "Buy my kid's school supplies this month: max $35 per item, $200 total, ask me for anything above $25. Expires at the end of the month.",
];

export function Home({ sandbox, liveCatalog, modelLabel }: { sandbox: boolean; liveCatalog: boolean; modelLabel: string }) {
  const router = useRouter();
  const [mandates, setMandates] = useState<MandateRow[] | null>(null);
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/mandates", { cache: "no-store" })
      .then((res) => res.json() as Promise<{ mandates: MandateRow[] }>)
      .then((json) => {
        if (alive) setMandates(json.mandates);
      })
      .catch(() => {
        if (alive) setMandates([]);
      });
    return () => {
      alive = false;
    };
  }, []);

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
    <Shell sandbox={sandbox}>
      <section className="hero">
        <h1>
          A shopping agent that spends <em>only what you allow.</em>
        </h1>
        <p className="lede">
          Write a mandate in plain words. Approve it once with PayPal. Errandly then runs your errands inside that budget, and pauses for you the moment
          anything falls outside it.
        </p>
        <ol className="steps">
          <li>
            <strong>Write a mandate.</strong> {modelLabel} turns it into a precise policy: caps per purchase and per period, categories, merchants, an
            auto-approve threshold.
          </li>
          <li>
            <strong>Consent once.</strong> You approve the mandate in PayPal; the wallet is vaulted. Revoking the mandate deletes the token.
          </li>
          <li>
            <strong>Run errands.</strong> The agent searches {liveCatalog ? "100M+ products via Channel3" : "the catalog"}, picks an offer, and a
            deterministic policy engine decides: pay now, ask you, or refuse. Every step is logged.
          </li>
        </ol>
      </section>

      <section className="card new-mandate">
        <h2>New mandate</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="e.g. Keep the home office stocked with paper and pens. Up to $60 per purchase, $150 a month, only Staples or Office Depot. Ask me before anything over $40."
        />
        <div className="examples">
          {EXAMPLES.map((ex, i) => (
            <button key={i} className="chip" onClick={() => setText(ex)} type="button">
              Example {i + 1}
            </button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="row end">
          <button className="primary" disabled={creating || text.trim().length < 10} onClick={() => void create()}>
            {creating ? "Reading your mandate…" : "Create mandate"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="section-title">Your mandates</h2>
        {mandates === null && <div className="muted">Loading…</div>}
        {mandates?.length === 0 && <div className="muted">No mandates yet. Create one above.</div>}
        <div className="mandate-grid">
          {mandates?.map((m) => (
            <Link key={m.id} href={`/mandates/${m.id}`} className="card mandate-card">
              <div className="row between">
                <h3>{m.name}</h3>
                <MandatePill status={m.status} />
              </div>
              <p className="muted clamp">{m.description}</p>
              <SpendMeter spent={m.spend.spent} max={m.policy.periodMax} currency={m.policy.currency} period={m.policy.period} />
              <div className="row between small muted">
                <span>{m.runCount} errands</span>
                {m.pending > 0 && <span className="pill pill-amber">{m.pending} awaiting approval</span>}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </Shell>
  );
}

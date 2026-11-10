import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Mandate, Run } from "./types";

/**
 * A tiny JSON-file store. Good enough for a demo on a single instance and
 * keeps the project free of native dependencies. Swap for Postgres by
 * replacing this module.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

type Db = { mandates: Mandate[]; runs: Run[] };

let cache: Db | null = null;
let queue: Promise<unknown> = Promise.resolve();

function file() {
  return path.join(DATA_DIR, "errand.json");
}

async function load(): Promise<Db> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(file(), "utf8");
    cache = JSON.parse(raw) as Db;
  } catch {
    cache = { mandates: [], runs: [] };
  }
  return cache;
}

async function persist(db: Db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, file());
}

/** Serialise mutations so concurrent requests cannot clobber each other. */
function mutate<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    await persist(db);
    return result;
  });
  queue = next.catch(() => undefined);
  return next;
}

export const newId = () => randomUUID().replace(/-/g, "").slice(0, 12);
export const now = () => new Date().toISOString();

export async function listMandates(): Promise<Mandate[]> {
  const db = await load();
  return [...db.mandates].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMandate(id: string): Promise<Mandate | undefined> {
  const db = await load();
  return db.mandates.find((m) => m.id === id);
}

export function saveMandate(m: Mandate): Promise<Mandate> {
  return mutate((db) => {
    const i = db.mandates.findIndex((x) => x.id === m.id);
    if (i >= 0) db.mandates[i] = m;
    else db.mandates.push(m);
    return m;
  });
}

export function updateMandate(id: string, patch: (m: Mandate) => void): Promise<Mandate> {
  return mutate((db) => {
    const m = db.mandates.find((x) => x.id === id);
    if (!m) throw new Error(`Mandate ${id} not found`);
    patch(m);
    return m;
  });
}

/**
 * PayPal can be connected only while a mandate is waiting for it. Revoking is final, and an
 * active mandate keeps its one payment token, so both are refused.
 * Returns null when connecting is allowed, otherwise the reason it is not.
 */
export function connectBlockedReason(m: Pick<Mandate, "status">): string | null {
  switch (m.status) {
    case "needs_paypal":
      return null;
    case "active":
      return "This mandate is already connected to PayPal.";
    case "revoked":
      return "This mandate has been revoked. Create a new mandate to run more errands.";
    case "expired":
      return "This mandate has expired. Create a new mandate to run more errands.";
    default:
      return "This mandate cannot be connected.";
  }
}

/**
 * Store a PayPal vault result and activate the mandate, but only if it is still waiting for PayPal.
 * The check and the write happen in one serialised step, so a revoke that lands while PayPal
 * redirects back cannot be undone by the return.
 */
export function activateMandate(id: string, paypal: Partial<Mandate["paypal"]>): Promise<{ activated: boolean; mandate: Mandate }> {
  return mutate((db) => {
    const m = db.mandates.find((x) => x.id === id);
    if (!m) throw new Error(`Mandate ${id} not found`);
    if (connectBlockedReason(m)) return { activated: false, mandate: m };
    m.paypal = { ...m.paypal, ...paypal };
    m.status = "active";
    return { activated: true, mandate: m };
  });
}

/** The agent gets this long for one errand; past it, the run is stopped. Gemini has taken over 5 minutes on a single step, so keep this generous. */
export const RUN_TIME_LIMIT_MS = 10 * 60_000;
/** A run still "running" with no update for this long was abandoned (for example, a restart). */
export const RUN_STALE_MS = 12 * 60_000;

/**
 * Close a run that was stopped early. A payment already recorded wins: the run is
 * completed with its receipt. Otherwise it fails and says nothing was charged.
 * Only touches runs still "running"; runs waiting for approval wait for a person.
 */
function settleInterrupted(r: Run, reason: string) {
  if (r.status !== "running") return false;
  r.interrupted = true;
  if (r.payment) {
    r.status = "completed";
    r.summary ??= "Paid. The agent was stopped before it wrote its summary; the PayPal receipt is above.";
    return true;
  }
  r.status = "failed";
  r.error = reason;
  r.steps.push({ at: now(), type: "error", title: "Stopped", detail: reason });
  r.summary = `${reason} Nothing was charged.`;
  return true;
}

export function stopRun(id: string, reason: string): Promise<Run> {
  return mutate((db) => {
    const r = db.runs.find((x) => x.id === id);
    if (!r) throw new Error(`Run ${id} not found`);
    settleInterrupted(r, reason);
    r.updatedAt = now();
    return r;
  });
}

/** A payment that lands after the run was stopped still counts: show it as completed. */
export function recoverLatePayment(r: Run) {
  if (r.payment && r.status === "failed" && r.interrupted) {
    r.status = "completed";
    r.summary = "Paid. The agent was stopped before it wrote its summary; the PayPal receipt is above.";
  }
}

/** Close abandoned runs. Cheap when there are none: the file is only written if one is found. */
async function sweepStaleRuns(at = Date.now()) {
  const db = await load();
  const stale = (r: Run) => r.status === "running" && at - Date.parse(r.updatedAt) > RUN_STALE_MS;
  if (!db.runs.some(stale)) return;
  await mutate((d) => {
    for (const r of d.runs) {
      if (stale(r) && settleInterrupted(r, "This errand was interrupted before it finished.")) r.updatedAt = now();
    }
  });
}

export async function listRuns(mandateId?: string): Promise<Run[]> {
  await sweepStaleRuns();
  const db = await load();
  return db.runs
    .filter((r) => !mandateId || r.mandateId === mandateId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRun(id: string): Promise<Run | undefined> {
  await sweepStaleRuns();
  const db = await load();
  return db.runs.find((r) => r.id === id);
}

export function saveRun(r: Run): Promise<Run> {
  return mutate((db) => {
    const i = db.runs.findIndex((x) => x.id === r.id);
    r.updatedAt = now();
    if (i >= 0) db.runs[i] = r;
    else db.runs.push(r);
    return r;
  });
}

export function updateRun(id: string, patch: (r: Run) => void): Promise<Run> {
  return mutate((db) => {
    const r = db.runs.find((x) => x.id === id);
    if (!r) throw new Error(`Run ${id} not found`);
    patch(r);
    r.updatedAt = now();
    return r;
  });
}

/**
 * Move a run out of `from` and apply `patch` in one serialised step. The status
 * check and the transition happen inside the same mutation, so of two
 * simultaneous requests exactly one claims the run and the other is refused.
 */
export function claimRun(id: string, from: Run["status"], patch: (r: Run) => void): Promise<Run> {
  return mutate((db) => {
    const r = db.runs.find((x) => x.id === id);
    if (!r) throw new Error(`Run ${id} not found`);
    if (r.status !== from) throw new Error(`Run is not ${from.replace("_", " ")}`);
    patch(r);
    r.updatedAt = now();
    return r;
  });
}

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

export async function listRuns(mandateId?: string): Promise<Run[]> {
  const db = await load();
  return db.runs
    .filter((r) => !mandateId || r.mandateId === mandateId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRun(id: string): Promise<Run | undefined> {
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

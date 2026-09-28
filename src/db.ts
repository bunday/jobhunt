import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

/** Everything personal lives under DATA_DIR (database + generated PDFs), never in the repo. */
export const DATA_DIR = process.env.JOBHUNT_DATA ?? `${import.meta.dir}/../data`;
export const OUT_DIR = `${DATA_DIR}/documents`;
mkdirSync(`${OUT_DIR}/specs`, { recursive: true });

export const db = new Database(`${DATA_DIR}/jobhunt.sqlite`, { create: true });
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id             INTEGER PRIMARY KEY,
  source         TEXT NOT NULL,            -- linkedin | greenhouse | lever | ashby | apple | adzuna | manual
  source_id      TEXT NOT NULL,
  url            TEXT NOT NULL,
  title          TEXT NOT NULL,
  company        TEXT NOT NULL,
  location       TEXT,
  work_mode      TEXT,                     -- remote | hybrid | onsite | unknown
  salary_text    TEXT,
  salary_min     INTEGER,
  salary_max     INTEGER,
  posted_at      TEXT,
  description    TEXT,
  is_agency      INTEGER DEFAULT 0,
  near_home      INTEGER DEFAULT 0,        -- found by a search around the user's home city
  country        TEXT,                     -- which searched country the job is in (gb, nl, us, ie, ca, tr)
  sponsor_status TEXT,                     -- licensed | likely | not_found | agency | n/a
  sponsor_name   TEXT,
  sponsor_text   TEXT,                     -- offers | refuses | none (what the ad says about visa sponsorship)
  score          INTEGER,
  reasons        TEXT,                     -- JSON array of human-readable scoring reasons
  status         TEXT NOT NULL DEFAULT 'new', -- new | shortlisted | tailoring | applied | interview | offer | rejected | skipped | closed
  cv_path        TEXT,
  cover_letter   TEXT,
  prep_state     TEXT,                     -- running | error: ... | NULL
  prep_review    TEXT,                     -- JSON {fit, fit_reason, gaps, suggestions, watch_outs}
  notes          TEXT,
  applied_at     TEXT,
  first_seen     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_id)
);
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY,
  job_id  INTEGER NOT NULL REFERENCES jobs(id),
  kind    TEXT NOT NULL,                   -- status | note
  detail  TEXT,
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS scans (
  id       INTEGER PRIMARY KEY,
  started  TEXT NOT NULL DEFAULT (datetime('now')),
  finished TEXT,
  found    INTEGER DEFAULT 0,
  added    INTEGER DEFAULT 0,
  log      TEXT
);
-- application form questions: the user adds question + rough draft, the AI writes the paste-ready answer
CREATE TABLE IF NOT EXISTS answers (
  id           INTEGER PRIMARY KEY,
  job_id       INTEGER NOT NULL REFERENCES jobs(id),
  position     INTEGER NOT NULL DEFAULT 0,
  question     TEXT NOT NULL,
  draft        TEXT,
  answer       TEXT,
  suggestions  TEXT,
  polish_state TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
-- answers to "to make this stronger" questions: facts about the user, reused by every future application
CREATE TABLE IF NOT EXISTS facts (
  id         INTEGER PRIMARY KEY,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  job_id     INTEGER REFERENCES jobs(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- settings, master CV and free-text facts, each stored as one JSON value
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_score ON jobs(score);
`);

// columns added after the first release
{
  const cols = db.query("PRAGMA table_info(jobs)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "near_home")) db.exec("ALTER TABLE jobs ADD COLUMN near_home INTEGER DEFAULT 0");
  if (!cols.some((c) => c.name === "country")) db.exec("ALTER TABLE jobs ADD COLUMN country TEXT");
}

export type Job = {
  id?: number;
  source: string;
  source_id: string;
  url: string;
  title: string;
  company: string;
  location?: string | null;
  work_mode?: string | null;
  salary_text?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  posted_at?: string | null;
  description?: string | null;
  is_agency?: number;
  near_home?: number;
  country?: string | null;
  sponsor_status?: string | null;
  sponsor_name?: string | null;
  sponsor_text?: string | null;
  score?: number | null;
  reasons?: string | null;
  status?: string;
};

export function jobExists(source: string, sourceId: string): boolean {
  return !!db.query("SELECT 1 FROM jobs WHERE source = ? AND source_id = ?").get(source, sourceId);
}

const COLS = [
  "source", "source_id", "url", "title", "company", "location", "work_mode", "salary_text",
  "salary_min", "salary_max", "posted_at", "description", "is_agency", "near_home", "country", "sponsor_status",
  "sponsor_name", "sponsor_text", "score", "reasons",
] as const;

/** Insert a new job, or refresh the scraped fields of an existing one (never touches status/notes). */
export function upsertJob(j: Job): { id: number; added: boolean } {
  const existing = db.query("SELECT id FROM jobs WHERE source = ? AND source_id = ?").get(j.source, j.source_id) as { id: number } | null;
  const vals = COLS.map((c) => (j as Record<string, unknown>)[c] ?? null);
  if (existing) {
    // near_home only ever goes up: the same job may also turn up in the nationwide remote search
    const set = COLS.map((c) => (c === "near_home" ? "near_home = MAX(COALESCE(near_home, 0), COALESCE(?, 0))" : `${c} = ?`)).join(", ");
    db.query(`UPDATE jobs SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(...(vals as never[]), existing.id);
    return { id: existing.id, added: false };
  }
  const r = db.query(`INSERT INTO jobs (${COLS.join(", ")}) VALUES (${COLS.map(() => "?").join(", ")})`).run(...(vals as never[]));
  return { id: Number(r.lastInsertRowid), added: true };
}

export function logEvent(jobId: number, kind: string, detail?: string) {
  db.query("INSERT INTO events (job_id, kind, detail) VALUES (?, ?, ?)").run(jobId, kind, detail ?? null);
}

export function kvGet<T>(k: string): T | null {
  const r = db.query("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | null;
  return r ? (JSON.parse(r.v) as T) : null;
}

export function kvSet(k: string, v: unknown) {
  db.query("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, JSON.stringify(v));
}

/** Facts the user confirmed in the app, formatted for the Prepare/Polish prompts. */
export function dashboardFacts(): string {
  const rows = db.query("SELECT question, answer FROM facts ORDER BY id").all() as { question: string; answer: string }[];
  if (!rows.length) return "(none yet)";
  return rows.map((r) => `- Q: ${r.question}\n  A (candidate): ${r.answer}`).join("\n");
}

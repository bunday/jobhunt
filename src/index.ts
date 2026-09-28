import { Elysia, t } from "elysia";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { aiStatus } from "./ai";
import { fileName, htmlToPdf, renderLetterHtml, renderPdf } from "./cv";
import { importCv, pdfToText } from "./cvimport";
import { db, logEvent, OUT_DIR, upsertJob, type Job } from "./db";
import { polishAnswer } from "./polish";
import { prepareJob } from "./prepare";
import { finalise, markDuplicates, rescoreAll, runScan, type ScanProgress } from "./scan";
import { COUNTRIES, getFactsText, getMasterCV, getSettings, saveFactsText, saveMasterCV, saveSettings, type MasterCV, type Settings } from "./settings";
import { hasRegister } from "./sponsors";

const PORT = Number(process.env.PORT ?? 3800);
const DIST = `${import.meta.dir}/../web/dist`;
const STATUSES = ["new", "shortlisted", "tailoring", "applied", "interview", "offer", "rejected", "skipped", "closed"] as const;

// A restart kills any in-flight AI job; don't leave cards spinning forever.
db.query("UPDATE jobs SET prep_state = 'error: interrupted by a server restart, click Prepare again' WHERE prep_state = 'running'").run();
db.query("UPDATE answers SET polish_state = 'error: interrupted by a server restart, click Polish again' WHERE polish_state = 'running'").run();
setInterval(() => {
  db.query("UPDATE jobs SET prep_state = 'error: timed out after 10 minutes, click Prepare again' WHERE prep_state = 'running' AND updated_at < datetime('now', '-10 minutes')").run();
  db.query("UPDATE answers SET polish_state = 'error: timed out after 10 minutes, click Polish again' WHERE polish_state = 'running' AND updated_at < datetime('now', '-10 minutes')").run();
}, 60_000);

const rescoreOne = (id: number) => { const r = db.query("SELECT * FROM jobs WHERE id = ?").get(id) as Job | null; if (r) upsertJob(finalise(r)); };

// ---------- scanning ----------
let scanning: Promise<unknown> | null = null;
let progress: ScanProgress | null = null;
function startScan(days?: number) {
  if (scanning || !getSettings().setupComplete) return false;
  progress = { stage: "Starting", found: 0, added: 0 };
  scanning = runScan({ postedWithin: days ? days * 86400 : undefined, progress: (p) => { progress = p; } })
    .catch((e) => { progress = { stage: `Scan failed: ${(e as Error).message}`, found: 0, added: 0 }; })
    .finally(() => { scanning = null; });
  return true;
}

// Daily scan at the user's chosen hour (container time zone: TZ in .env).
let lastAuto = "";
setInterval(() => {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (now.getHours() === getSettings().scanHour && lastAuto !== day) { lastAuto = day; startScan(2); }
}, 60_000);

const LIST_COLS = "id, source, url, title, company, location, work_mode, salary_text, salary_min, salary_max, posted_at, is_agency, sponsor_status, sponsor_name, sponsor_text, score, reasons, status, cv_path, notes, applied_at, first_seen, updated_at, prep_state";
const STAGE_WORD: Record<string, string> = { shortlisted: "Shortlisted", tailoring: "Documents ready, not yet applied", applied: "Applied", interview: "Interview stage", offer: "Offer", rejected: "Rejected", skipped: "Skipped" };

const app = new Elysia()
  .onError(({ error, set }) => { set.status = 500; return { error: (error as Error).message }; })
  .get("/api/health", () => ({
    ok: true,
    busy: (db.query("SELECT (SELECT COUNT(*) FROM jobs WHERE prep_state = 'running') + (SELECT COUNT(*) FROM answers WHERE polish_state = 'running') n").get() as { n: number }).n,
  }))

  // ---------- setup & settings ----------
  .get("/api/setup", () => ({
    settings: getSettings(),
    cv: getMasterCV(),
    factsText: getFactsText(),
    ai: aiStatus(),
    adzuna: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
    countries: Object.fromEntries(Object.entries(COUNTRIES).map(([k, c]) => [k, { name: c.name, symbol: c.symbol, sponsorRegister: hasRegister(k as never) }])),
  }))
  .post("/api/setup/cv", async ({ body }) => {
    const text = body.file ? await pdfToText(body.file) : body.text ?? "";
    return importCv(text);
  }, { body: t.Object({ file: t.Optional(t.File()), text: t.Optional(t.String()) }) })
  .put("/api/settings", ({ body }) => {
    const before = getSettings();
    const s = saveSettings(body as Partial<Settings>);
    // anything that changes how jobs are judged: re-score what's already there
    const judge = ["targetRoles", "seniority", "strongSkills", "weakSkills", "country", "homeCity", "commutable", "remotePreference", "maxOfficeDays", "salaryMin", "needsSponsorship", "sponsorSalaryFloor", "excludeCompanies"] as const;
    if (s.setupComplete && judge.some((k) => JSON.stringify(before[k]) !== JSON.stringify(s[k]))) rescoreAll();
    return s;
  }, { body: t.Record(t.String(), t.Any()) })
  .put("/api/cv", ({ body }) => { saveMasterCV(body as MasterCV); return { ok: true }; }, { body: t.Record(t.String(), t.Any()) })
  .put("/api/facts-text", ({ body }) => { saveFactsText(body.text); return { ok: true }; }, { body: t.Object({ text: t.String() }) })
  .post("/api/setup/complete", () => {
    const s = getSettings();
    const missing = [!s.name && "your name", !s.targetRoles.length && "at least one target role", !getMasterCV().experience.length && "your CV"].filter(Boolean);
    if (missing.length) return { ok: false, error: `Still needed: ${missing.join(", ")}` };
    saveSettings({ setupComplete: true });
    startScan(14); // first scan looks back two weeks
    return { ok: true };
  })
  // Start over: delete everything personal (jobs, applications, answers, facts, settings, CV, documents) and return to setup.
  // Sponsor register caches are public data and are kept.
  .post("/api/reset", ({ body, set }) => {
    if (body.confirm !== "RESET") { set.status = 400; return { error: "Type RESET to confirm" }; }
    const busy = (db.query("SELECT (SELECT COUNT(*) FROM jobs WHERE prep_state = 'running') + (SELECT COUNT(*) FROM answers WHERE polish_state = 'running') n").get() as { n: number }).n;
    if (scanning || busy) { set.status = 409; return { error: "A search or an AI task is running. Wait for it to finish, then try again." }; }
    db.transaction(() => { for (const t of ["events", "answers", "facts", "jobs", "scans", "kv"]) db.run(`DELETE FROM ${t}`); })();
    for (const f of readdirSync(OUT_DIR)) if (f !== "specs") rmSync(`${OUT_DIR}/${f}`, { force: true, recursive: true });
    for (const f of readdirSync(`${OUT_DIR}/specs`)) rmSync(`${OUT_DIR}/specs/${f}`, { force: true });
    progress = null;
    db.run("VACUUM");
    return { ok: true };
  }, { body: t.Object({ confirm: t.String() }) })
  .get("/api/master-cv.pdf", async ({ set }) => {
    const out = `${OUT_DIR}/master.pdf`;
    await renderPdf({}, out);
    set.headers["content-type"] = "application/pdf";
    set.headers["content-disposition"] = `inline; filename="${fileName("CV", "Master")}"`;
    return Bun.file(out);
  })

  // ---------- scanning ----------
  .post("/api/scan", ({ query }) => ({ started: startScan(query.days ? Number(query.days) : undefined) }))
  .get("/api/scan/status", () => ({ scanning: !!scanning, progress, lastScan: db.query("SELECT started, finished, found, added FROM scans WHERE finished IS NOT NULL ORDER BY id DESC LIMIT 1").get() }))
  .post("/api/rescore", () => ({ rescored: rescoreAll() }))

  // ---------- overview ----------
  .get("/api/overview", () => {
    const counts = Object.fromEntries((db.query("SELECT status, COUNT(*) n FROM jobs GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
    const applications = db.query(`
      SELECT j.id, j.title, j.company, j.status, j.applied_at, j.cv_path, j.score, j.updated_at,
        (SELECT detail FROM events e WHERE e.job_id = j.id AND e.kind = 'status' ORDER BY e.id DESC LIMIT 1) AS last_status
      FROM jobs j WHERE j.status IN ('shortlisted','tailoring','applied','interview','offer','rejected')
      ORDER BY CASE j.status WHEN 'offer' THEN 0 WHEN 'interview' THEN 1 WHEN 'applied' THEN 2 WHEN 'tailoring' THEN 3 WHEN 'shortlisted' THEN 4 ELSE 5 END,
        COALESCE(j.applied_at, '') DESC, j.score DESC`).all() as { id: number; company: string; status: string; applied_at: string | null; cv_path: string | null; last_status: string | null; last_event?: string }[];
    for (const a of applications) a.last_event = STAGE_WORD[a.status] ?? "";
    const attention: { kind: string; text: string; job_id?: number }[] = [];
    for (const a of applications) {
      if (a.status === "interview") attention.push({ kind: "interview", text: `Interview stage at ${a.company}: prepare`, job_id: a.id });
      if (a.status === "offer") attention.push({ kind: "offer", text: `Offer from ${a.company}: review it`, job_id: a.id });
      if (a.status === "applied" && a.applied_at) {
        const days = Math.floor((Date.now() - Date.parse(`${a.applied_at.replace(" ", "T")}Z`)) / 86400_000);
        if (days >= 10) attention.push({ kind: "followup", text: `Applied to ${a.company} ${days} days ago: consider a follow-up`, job_id: a.id });
      }
    }
    const waiting = db.query("SELECT j.company, COUNT(*) n FROM answers a JOIN jobs j ON j.id = a.job_id WHERE (a.answer IS NULL OR a.answer = '') AND j.status NOT IN ('applied','interview','offer','rejected','skipped','closed') GROUP BY j.id").all() as { company: string; n: number }[];
    for (const w of waiting) attention.push({ kind: "polish", text: `${w.n} application question${w.n > 1 ? "s" : ""} for ${w.company} not polished yet` });
    const untailored = applications.filter((a) => a.status === "shortlisted" && !a.cv_path).length;
    if (untailored) attention.push({ kind: "tailor", text: `${untailored} shortlisted job${untailored > 1 ? "s" : ""} not prepared yet` });
    const strongNew = (db.query("SELECT COUNT(*) n FROM jobs WHERE status = 'new' AND score >= 60").get() as { n: number }).n;
    // the whole pool the scanner has found (duplicates are hidden, so they don't count)
    const pool = db.query(`SELECT COUNT(*) total, SUM(status = 'new') fresh, SUM(status = 'new' AND score >= 50) good, SUM(status = 'new' AND score >= 70) strong,
      SUM(first_seen >= datetime('now', '-1 day')) today FROM jobs WHERE status != 'duplicate'`).get() as { total: number; fresh: number; good: number; strong: number; today: number };
    const lastScan = db.query("SELECT started, found, added FROM scans WHERE finished IS NOT NULL ORDER BY id DESC LIMIT 1").get();
    return { counts, applications, attention, strongNew, pool, lastScan, scanning: !!scanning };
  })

  // ---------- jobs ----------
  .get("/api/jobs", ({ query }) => {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (query.status) { where.push(`status IN (${query.status.split(",").map(() => "?").join(",")})`); args.push(...query.status.split(",")); }
    if (query.minScore) { where.push("score >= ?"); args.push(Number(query.minScore)); }
    if (query.q) { where.push("(title LIKE ? OR company LIKE ?)"); args.push(`%${query.q}%`, `%${query.q}%`); }
    return db.query(`SELECT ${LIST_COLS} FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY score DESC, first_seen DESC LIMIT 300`).all(...args);
  })
  .get("/api/jobs/:id", ({ params, set }) => {
    const id = Number(params.id);
    const job = db.query("SELECT * FROM jobs WHERE id = ?").get(id);
    if (!job) { set.status = 404; return { error: "not found" }; }
    return {
      ...job,
      events: db.query("SELECT * FROM events WHERE job_id = ? ORDER BY id DESC").all(id),
      answers: db.query("SELECT * FROM answers WHERE job_id = ? ORDER BY position, id").all(id),
    };
  })
  .patch("/api/jobs/:id", ({ params, body }) => {
    const id = Number(params.id);
    const cur = db.query("SELECT status FROM jobs WHERE id = ?").get(id) as { status: string } | null;
    if (!cur) return { error: "not found" };
    if (body.status && body.status !== cur.status) {
      db.query("UPDATE jobs SET status = ?, applied_at = CASE WHEN ? = 'applied' AND applied_at IS NULL THEN datetime('now') ELSE applied_at END, updated_at = datetime('now') WHERE id = ?").run(body.status, body.status, id);
      logEvent(id, "status", `${cur.status} → ${body.status}`);
    }
    if (body.notes !== undefined) db.query("UPDATE jobs SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(body.notes, id);
    if (body.cover_letter !== undefined) db.query("UPDATE jobs SET cover_letter = ?, updated_at = datetime('now') WHERE id = ?").run(body.cover_letter, id);
    if (body.description !== undefined) {
      db.query("UPDATE jobs SET description = ?, updated_at = datetime('now') WHERE id = ?").run(body.description, id);
      logEvent(id, "note", "full job description pasted");
      rescoreOne(id);
    }
    if (body.event) logEvent(id, "note", body.event);
    return { ok: true };
  }, { body: t.Object({ status: t.Optional(t.Union(STATUSES.map((s) => t.Literal(s)))), notes: t.Optional(t.String()), cover_letter: t.Optional(t.String()), description: t.Optional(t.String()), event: t.Optional(t.String()) }) })
  .post("/api/jobs", ({ body }) => {
    // manual add (e.g. a job found on another site): scored like everything else
    const j: Job = { source: "manual", source_id: body.url, url: body.url, title: body.title, company: body.company, location: body.location ?? null, work_mode: body.work_mode ?? "unknown", salary_text: body.salary_text ?? null, description: body.description ?? null };
    const { id } = upsertJob(finalise(j));
    logEvent(id, "note", "added manually");
    markDuplicates();
    return { id };
  }, { body: t.Object({ url: t.String(), title: t.String(), company: t.String(), location: t.Optional(t.String()), work_mode: t.Optional(t.String()), salary_text: t.Optional(t.String()), description: t.Optional(t.String()) }) })
  .post("/api/jobs/:id/prepare", ({ params }) => {
    const id = Number(params.id);
    const cur = db.query("SELECT prep_state FROM jobs WHERE id = ?").get(id) as { prep_state: string | null } | null;
    if (!cur) return { error: "not found" };
    if (cur.prep_state === "running") return { started: false, running: true };
    prepareJob(id); // async: the card polls until prep_state clears
    return { started: true };
  })

  // ---------- application questions ----------
  .post("/api/jobs/:id/answers", ({ params, body }) => {
    const id = Number(params.id);
    const pos = (db.query("SELECT COALESCE(MAX(position), 0) + 1 p FROM answers WHERE job_id = ?").get(id) as { p: number }).p;
    const r = db.query("INSERT INTO answers (job_id, position, question, draft) VALUES (?, ?, ?, ?)").run(id, pos, body.question, body.draft ?? null);
    return { id: Number(r.lastInsertRowid) };
  }, { body: t.Object({ question: t.String(), draft: t.Optional(t.String()) }) })
  .patch("/api/answers/:id", ({ params, body }) => {
    for (const k of ["question", "draft", "answer"] as const) {
      if (body[k] !== undefined) db.query(`UPDATE answers SET ${k} = ?, updated_at = datetime('now') WHERE id = ?`).run(body[k], Number(params.id));
    }
    return { ok: true };
  }, { body: t.Object({ question: t.Optional(t.String()), draft: t.Optional(t.String()), answer: t.Optional(t.String()) }) })
  .post("/api/answers/:id/polish", ({ params }) => {
    const id = Number(params.id);
    const cur = db.query("SELECT polish_state FROM answers WHERE id = ?").get(id) as { polish_state: string | null } | null;
    if (!cur) return { error: "not found" };
    if (cur.polish_state === "running") return { started: false, running: true };
    polishAnswer(id);
    return { started: true };
  })
  .delete("/api/answers/:id", ({ params }) => { db.query("DELETE FROM answers WHERE id = ?").run(Number(params.id)); return { ok: true }; })

  // ---------- facts (answers to "to make this stronger" questions; apply to every job) ----------
  .get("/api/facts", () => db.query("SELECT f.*, j.company FROM facts f LEFT JOIN jobs j ON j.id = f.job_id ORDER BY f.id DESC").all())
  .post("/api/facts", ({ body }) => {
    db.query("DELETE FROM facts WHERE question = ?").run(body.question);
    const r = db.query("INSERT INTO facts (question, answer, job_id) VALUES (?, ?, ?)").run(body.question, body.answer, body.job_id ?? null);
    return { id: Number(r.lastInsertRowid) };
  }, { body: t.Object({ question: t.String(), answer: t.String(), job_id: t.Optional(t.Number()) }) })
  .patch("/api/facts/:id", ({ params, body }) => { db.query("UPDATE facts SET answer = ? WHERE id = ?").run(body.answer, Number(params.id)); return { ok: true }; }, { body: t.Object({ answer: t.String() }) })
  .delete("/api/facts/:id", ({ params }) => { db.query("DELETE FROM facts WHERE id = ?").run(Number(params.id)); return { ok: true }; })

  // ---------- documents (file names are what recruiters see) ----------
  .get("/api/cv/:id", ({ params, query, set }) => {
    const row = db.query("SELECT cv_path, company FROM jobs WHERE id = ?").get(Number(params.id)) as { cv_path: string | null; company: string } | null;
    const p = row?.cv_path ? `${OUT_DIR}/${row.cv_path}` : null;
    if (!p || !existsSync(p)) { set.status = 404; return "no tailored CV yet"; }
    set.headers["content-type"] = "application/pdf";
    set.headers["content-disposition"] = `${query.download ? "attachment" : "inline"}; filename="${fileName("CV", row!.company)}"`;
    return Bun.file(p);
  })
  .get("/api/jobs/:id/cover-letter.pdf", async ({ params, query, set }) => {
    const job = db.query("SELECT id, title, company, cover_letter FROM jobs WHERE id = ?").get(Number(params.id)) as { id: number; title: string; company: string; cover_letter: string | null } | null;
    if (!job?.cover_letter?.trim()) { set.status = 404; return "no cover letter yet"; }
    const spec = (() => { try { return JSON.parse(readFileSync(`${OUT_DIR}/specs/${job.id}.json`, "utf8")) as { headline?: string }; } catch { return {}; } })();
    const out = `${OUT_DIR}/${job.id}-cover-letter.pdf`;
    // rendered on demand, so edits made on the card are always included
    await htmlToPdf(renderLetterHtml({ text: job.cover_letter, title: job.title, company: job.company, headline: spec.headline }), out);
    set.headers["content-type"] = "application/pdf";
    set.headers["content-disposition"] = `${query.download ? "attachment" : "inline"}; filename="${fileName("Cover Letter", job.company)}"`;
    return Bun.file(out);
  })

  // ---------- the web app ----------
  .get("/*", ({ params }) => {
    const p = params["*"];
    return p && existsSync(`${DIST}/${p}`) ? Bun.file(`${DIST}/${p}`) : Bun.file(`${DIST}/index.html`);
  })
  .listen(PORT);

const ai = aiStatus();
console.log(`jobhunt on http://localhost:${app.server?.port}  (AI: ${ai.provider} ${ai.model}${ai.configured ? "" : ` - NOT CONFIGURED: ${ai.problem}`})`);

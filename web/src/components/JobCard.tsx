import { ChevronDown, Copy, Download, ExternalLink, FileText, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type Answer, type Fact, type JobFull, type JobRow, type Review } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/form";
import { ago, cn, moneyRange } from "@/lib/utils";
import { sameQuestion } from "@/similar";

export const STATUSES = ["new", "shortlisted", "tailoring", "applied", "interview", "offer", "rejected", "skipped", "closed"];
const STATUS_LABEL: Record<string, string> = { new: "New", shortlisted: "Shortlisted", tailoring: "Prepared", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected", skipped: "Skipped", closed: "Closed" };
const SPONSOR: Record<string, [string, "good" | "info" | "warn" | "bad"]> = {
  licensed: ["Licensed sponsor", "good"], likely: ["Probably licensed", "info"], agency: ["Recruiter: ask about sponsorship", "warn"], not_found: ["Not on sponsor register", "bad"],
};

function ScoreRing({ score }: { score: number }) {
  const tone = score >= 70 ? "text-success border-success/50" : score >= 50 ? "text-primary border-primary/40" : "text-muted-foreground border-border";
  return <div className={cn("grid size-10 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold tabular-nums", tone)} title="Match score">{score}</div>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1500);
  };
  return <Button variant="outline" size="sm" onClick={copy}><Copy />{done ? "Copied" : "Copy"}</Button>;
}

/** A "to make this stronger" question with an answer box. Answers are facts about the user, reused by every job. */
function Suggestion({ q, jobId, facts, onSaved }: { q: string; jobId: number; facts: Fact[]; onSaved: () => void }) {
  const saved = facts.find((f) => f.question === q) ?? facts.find((f) => sameQuestion(f.question, q));
  const elsewhere = saved && saved.question !== q;
  const [val, setVal] = useState(saved?.answer ?? "");
  const [editing, setEditing] = useState(!saved);
  const [state, setState] = useState<"" | "saving" | "saved">("");
  // facts load after first render: once a saved answer shows up, display it instead of an empty box
  useEffect(() => { if (saved && state === "") { setVal(saved.answer); setEditing(false); } }, [saved?.id]);
  const save = async () => {
    const v = val.trim();
    if (!v || (saved && v === saved.answer && !elsewhere)) { if (saved) setEditing(false); return; }
    setState("saving");
    await api.saveFact({ question: q, answer: v, job_id: jobId });
    setState("saved"); setEditing(false); onSaved();
  };
  return (
    <li className="grid gap-1.5 border-l-2 border-primary/40 pl-3">
      <span className="text-sm">{q}</span>
      {editing ? (
        <Input className="h-8" placeholder="Your answer (saves automatically; a plain 'No' helps too)" value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} />
      ) : (
        <span className="text-sm text-success">✓ {elsewhere ? "Already answered: " : ""}{saved?.answer} <button type="button" className="ml-1 text-xs text-primary hover:underline cursor-pointer" onClick={() => setEditing(true)}>edit</button></span>
      )}
    </li>
  );
}

function ReviewPanel({ review, jobId, facts, onSaved }: { review: Review; jobId: number; facts: Fact[]; onSaved: () => void }) {
  const tone = review.fit === "strong" ? "good" : review.fit === "reasonable" ? "info" : "warn";
  const answered = (review.suggestions ?? []).filter((q) => facts.some((f) => sameQuestion(f.question, q))).length;
  return (
    <div className="grid gap-4 rounded-md bg-muted/60 p-4">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={tone}>Fit: {review.fit}</Badge><span className="text-sm">{review.fit_reason}</span></div>
      {review.suggestions?.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm"><strong>To make this stronger</strong> <span className="text-muted-foreground">({answered}/{review.suggestions.length} answered. Answers are saved to your profile for every job; click Prepare again to use them here.)</span></p>
          <ul className="grid gap-3">{review.suggestions.map((q) => <Suggestion key={q} q={q} jobId={jobId} facts={facts} onSaved={onSaved} />)}</ul>
        </div>
      )}
      {review.gaps?.length > 0 && <div><p className="text-sm font-semibold">Gaps against the ad</p><ul className="mt-1 list-disc pl-5 text-sm text-destructive">{review.gaps.map((g) => <li key={g}>{g}</li>)}</ul></div>}
      {review.watch_outs?.length > 0 && <div><p className="text-sm font-semibold">Watch-outs</p><ul className="mt-1 list-disc pl-5 text-sm">{review.watch_outs.map((g) => <li key={g}>{g}</li>)}</ul></div>}
    </div>
  );
}

function QuestionItem({ a, onChange, facts, onFact }: { a: Answer; onChange: () => void; facts: Fact[]; onFact: () => void }) {
  const [draft, setDraft] = useState(a.draft ?? "");
  const [editing, setEditing] = useState(!a.answer);
  const running = a.polish_state === "running";
  const failed = a.polish_state?.startsWith("error");
  const tips: string[] = a.suggestions ? JSON.parse(a.suggestions) : [];
  useEffect(() => { if (!running) return; const t = setInterval(onChange, 3000); return () => clearInterval(t); }, [running, onChange]);
  const polish = async () => { if (draft !== (a.draft ?? "")) await api.patchAnswer(a.id, { draft }); await api.polish(a.id); onChange(); };
  return (
    <div className="grid gap-2 border-t pt-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{a.question}</p>
        <Button variant="ghost" size="sm" onClick={async () => { if (confirm("Delete this question?")) { await api.deleteAnswer(a.id); onChange(); } }}><Trash2 /></Button>
      </div>
      {editing
        ? <Textarea rows={4} placeholder="Your rough answer" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== (a.draft ?? "") && api.patchAnswer(a.id, { draft })} />
        : <button type="button" className="w-fit text-xs text-primary hover:underline cursor-pointer" onClick={() => setEditing(true)}>{a.draft ? "Edit your draft" : "Add your draft"}</button>}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={running} onClick={polish}>{running ? <Loader2 className="animate-spin" /> : <Sparkles />}{running ? "Polishing…" : a.answer ? "Polish again" : "Polish"}</Button>
        {running && <span className="text-xs text-muted-foreground">Usually under a minute</span>}
        {failed && <span className="text-xs text-destructive">Polish failed: {a.polish_state!.slice(7)}</span>}
      </div>
      {a.answer && !running && (
        <div className="grid gap-2 rounded-md bg-muted/60 p-3">
          <div className="flex items-center gap-2"><Badge tone="good">Ready to paste</Badge><CopyButton text={a.answer} /></div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{a.answer}</p>
          {tips.length > 0 && (
            <div className="grid gap-2 border-t pt-2">
              <p className="text-xs font-medium">To make this stronger: answer, then Polish again</p>
              <ul className="grid gap-2">{tips.map((t) => <Suggestion key={t} q={t} jobId={a.job_id} facts={facts} onSaved={onFact} />)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApplicationPack({ full, reload }: { full: JobFull; reload: () => void }) {
  const [q, setQ] = useState("");
  const [d, setD] = useState("");
  const [letter, setLetter] = useState(full.cover_letter ?? "");
  const [savedLetter, setSavedLetter] = useState(full.cover_letter ?? "");
  const [savingLetter, setSavingLetter] = useState(false);
  const [facts, setFacts] = useState<Fact[]>([]);
  const loadFacts = useCallback(() => { api.facts().then(setFacts); }, []);
  useEffect(() => { loadFacts(); }, [loadFacts]);
  useEffect(() => { setLetter(full.cover_letter ?? ""); setSavedLetter(full.cover_letter ?? ""); }, [full.cover_letter]);

  const letterDirty = letter !== savedLetter;
  const saveLetter = useCallback(async (text: string) => {
    setSavingLetter(true);
    try { await api.patchJob(full.id, { cover_letter: text }); setSavedLetter(text); } finally { setSavingLetter(false); }
  }, [full.id]);
  // autosave shortly after typing stops; PDF buttons stay disabled until the latest text is saved
  useEffect(() => { if (!letterDirty) return; const t = setTimeout(() => saveLetter(letter), 1200); return () => clearTimeout(t); }, [letter, letterDirty, saveLetter]);

  const running = full.prep_state === "running";
  const failed = full.prep_state?.startsWith("error");
  const review: Review | null = full.prep_review ? JSON.parse(full.prep_review) : null;
  const snippetOnly = (full.description ?? "").length < 700;
  useEffect(() => { if (!running) return; const t = setInterval(reload, 4000); return () => clearInterval(t); }, [running, reload]);

  const prepare = async () => {
    if (snippetOnly && !confirm("Only a short snippet of this ad is available, so the CV and letter will be generic. Paste the full description first for a better result. Prepare anyway?")) return;
    if ((full.cv_path || full.cover_letter) && !confirm("Prepare again? This replaces the tailored CV, cover letter and review for this job.")) return;
    await api.prepare(full.id); reload();
  };
  const pdfBlocked = savingLetter || letterDirty;

  return (
    <div className="grid gap-5 rounded-lg border border-primary/25 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">Application pack</h4>
        <Button disabled={running} onClick={prepare}>{running ? <Loader2 className="animate-spin" /> : <Sparkles />}{running ? "Preparing…" : full.cv_path ? "Prepare again" : "Prepare application"}</Button>
      </div>
      {running && <p className="-mt-3 text-sm text-muted-foreground">Reading the ad, tailoring your CV and writing a cover letter. About 1 to 3 minutes.</p>}
      {failed && <p className="-mt-3 text-sm text-destructive">Prepare failed: {full.prep_state!.slice(7)}</p>}
      {review && !running && <ReviewPanel review={review} jobId={full.id} facts={facts} onSaved={loadFacts} />}

      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 text-sm font-medium">CV</span>
        {full.cv_path ? (
          <>
            <ButtonLink href={`/api/cv/${full.id}?v=${encodeURIComponent(full.updated_at)}`} target="_blank" rel="noreferrer"><FileText /> Open tailored CV</ButtonLink>
            <ButtonLink variant="outline" href={`/api/cv/${full.id}?download=1`}><Download /> Download</ButtonLink>
          </>
        ) : <span className="text-sm text-muted-foreground">Not tailored yet: click Prepare application.</span>}
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-sm font-medium">Cover letter</span>
          {(full.cover_letter || savedLetter) ? (
            <>
              <CopyButton text={letter} />
              <ButtonLink variant="outline" size="sm" disabled={pdfBlocked} href={`/api/jobs/${full.id}/cover-letter.pdf`} target="_blank" rel="noreferrer"><FileText /> View PDF</ButtonLink>
              <ButtonLink variant="outline" size="sm" disabled={pdfBlocked} href={`/api/jobs/${full.id}/cover-letter.pdf?download=1`}><Download /> Download PDF</ButtonLink>
              <span className="text-xs text-muted-foreground">{savingLetter ? "Saving…" : letterDirty ? "Unsaved changes, saving shortly…" : "✓ Saved"}</span>
            </>
          ) : <span className="text-sm text-muted-foreground">None yet.</span>}
        </div>
        {(full.cover_letter || savedLetter) && <Textarea rows={12} value={letter} onChange={(e) => setLetter(e.target.value)} onBlur={() => letterDirty && saveLetter(letter)} />}
      </div>

      <div className="grid gap-3">
        <span className="text-sm font-medium">Application questions</span>
        {full.answers.length === 0 && <p className="text-sm text-muted-foreground">Add each question from the application form with your rough answer, then Polish it into a paste-ready answer.</p>}
        {full.answers.map((a) => <QuestionItem key={`${a.id}-${a.answer ?? ""}`} a={a} onChange={reload} facts={facts} onFact={loadFacts} />)}
        <div className="grid gap-2 border-t pt-4">
          <Textarea rows={2} className="min-h-0" placeholder="Question from the application form" value={q} onChange={(e) => setQ(e.target.value)} />
          <Textarea rows={3} placeholder="Your rough answer (optional)" value={d} onChange={(e) => setD(e.target.value)} />
          <Button variant="outline" className="w-fit" disabled={!q.trim()} onClick={async () => { await api.addAnswer(full.id, { question: q.trim(), draft: d.trim() || undefined }); setQ(""); setD(""); reload(); }}>Add question</Button>
        </div>
      </div>
    </div>
  );
}

export function JobCard({ row, onChange, defaultOpen = false }: { row: JobRow; onChange: () => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [full, setFull] = useState<JobFull | null>(null);
  const [notes, setNotes] = useState(row.notes ?? "");
  const [pasted, setPasted] = useState("");
  const reload = useCallback(() => { api.job(row.id).then(setFull); }, [row.id]);
  useEffect(() => { if (open && !full) reload(); }, [open, full, reload]);
  const reasons: string[] = row.reasons ? JSON.parse(row.reasons) : [];
  const sponsor = row.sponsor_status && SPONSOR[row.sponsor_status];
  const money = moneyRange(row.salary_min, row.salary_max) ?? row.salary_text;
  const setStatus = async (status: string) => { await api.patchJob(row.id, { status }); onChange(); };
  const snippetOnly = full && (full.description ?? "").length < 700;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 p-4">
        <ScoreRing score={row.score} />
        <button type="button" className="min-w-0 flex-1 text-left cursor-pointer" onClick={() => setOpen(!open)}>
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{row.title}</span>
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{row.company}</span>
            {row.location && <span className="truncate">{row.location}</span>}
            {row.work_mode && row.work_mode !== "unknown" && <Badge tone="outline">{row.work_mode}</Badge>}
            {money && <Badge tone="outline">{money}</Badge>}
            {sponsor && <Badge tone={sponsor[1]}>{sponsor[0]}</Badge>}
            {row.sponsor_text === "offers" && <Badge tone="good">Ad offers sponsorship</Badge>}
            {row.sponsor_text === "refuses" && <Badge tone="bad">Ad: no sponsorship</Badge>}
            <span className="text-xs">{row.source} · {ago(row.posted_at ?? row.first_seen)}</span>
          </div>
        </button>
        <Select className="w-36 shrink-0" value={row.status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </Select>
      </div>
      {open && (
        <div className="grid gap-5 border-t p-4">
          {full && snippetOnly && (
            <div className="grid gap-2 rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="text-sm"><strong>Only a short snippet of this ad is available.</strong> Open the ad, copy the full description and paste it here so the score and Prepare use the real ad.</p>
              <Textarea rows={5} placeholder="Paste the full job description" value={pasted} onChange={(e) => setPasted(e.target.value)} />
              <div className="flex gap-2">
                <ButtonLink variant="outline" size="sm" href={row.url} target="_blank" rel="noreferrer"><ExternalLink /> Open the ad</ButtonLink>
                <Button size="sm" disabled={pasted.trim().length < 200} onClick={async () => { await api.patchJob(row.id, { description: pasted.trim() }); setPasted(""); reload(); onChange(); }}>Save description</Button>
              </div>
            </div>
          )}
          {full && ["shortlisted", "tailoring", "applied", "interview", "offer"].includes(row.status) && <ApplicationPack full={full} reload={() => { reload(); onChange(); }} />}
          {row.status === "new" && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setStatus("shortlisted")}>Shortlist</Button>
              <Button variant="outline" onClick={() => setStatus("skipped")}>Skip</Button>
              <ButtonLink variant="ghost" href={row.url} target="_blank" rel="noreferrer"><ExternalLink /> Open the ad</ButtonLink>
            </div>
          )}
          <div className="grid gap-1">
            <p className="text-sm font-semibold">Why this score</p>
            <ul className="grid gap-0.5 text-sm">
              {reasons.map((r) => <li key={r} className={r[0] === "+" ? "text-success" : r[0] === "−" ? "text-destructive" : "text-warning"}>{r}</li>)}
            </ul>
            {row.sponsor_name && <p className="text-xs text-muted-foreground">Sponsor register: {row.sponsor_name}</p>}
          </div>
          <div className="grid gap-1">
            <p className="text-sm font-semibold">Notes</p>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (row.notes ?? "") && api.patchJob(row.id, { notes })} placeholder="Recruiter name, salary conversation, interview dates…" />
          </div>
          {!!full?.events?.length && (
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">History ({full.events.length})</summary>
              <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">{full.events.map((e) => <li key={e.id}>{e.at} · {e.detail}</li>)}</ul>
            </details>
          )}
          {full?.description && (
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Full job description</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm">{full.description}</pre>
            </details>
          )}
          {row.status !== "new" && <ButtonLink variant="ghost" className="w-fit" href={row.url} target="_blank" rel="noreferrer"><ExternalLink /> Open the ad</ButtonLink>}
        </div>
      )}
    </Card>
  );
}

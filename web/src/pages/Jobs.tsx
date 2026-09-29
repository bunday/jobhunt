import { ClipboardPaste, Link2, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type JobDraft, type JobRow, type ScanStatus } from "@/api";
import { JobCard } from "@/components/JobCard";
import { app } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

export type ListKind = "applications" | "discover" | "closed";
const QUERY: Record<ListKind, { status: string; order?: string[] }> = {
  applications: { status: "shortlisted,tailoring,applied,interview,offer", order: ["offer", "interview", "applied", "tailoring", "shortlisted"] },
  discover: { status: "new" },
  closed: { status: "rejected,skipped,closed" },
};

export function Jobs({ kind, focus: focusProp }: { kind: ListKind; focus: number | null }) {
  const [added, setAdded] = useState<{ id: number; existing: boolean; status: string } | null>(null);
  const focus = added?.id ?? focusProp;
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState("50");
  const [country, setCountry] = useState("");
  const [adding, setAdding] = useState(false);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const load = useCallback(async () => {
    const p: Record<string, string> = { status: QUERY[kind].status };
    if (q) p.q = q;
    if (kind === "discover" && minScore) { p.minScore = minScore; if (focus) p.include = String(focus); }
    if (country) p.country = country;
    const r = await api.jobs(p);
    const order = QUERY[kind].order;
    if (order) r.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    if (focus) r.sort((a, b) => (a.id === focus ? -1 : b.id === focus ? 1 : 0));
    setRows(r);
  }, [kind, q, minScore, country, focus]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (kind !== "discover") return;
    const tick = async () => { const s = await api.scanStatus(); setScan(s); };
    tick(); const t = setInterval(tick, 4000); return () => clearInterval(t);
  }, [kind]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search title or company" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {app.searched.length > 1 && (
          <Select className="w-44" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
            <option value="">All countries</option>
            {app.searched.map((c) => <option key={c} value={c}>{app.countries[c]?.name ?? c}</option>)}
          </Select>
        )}
        {kind === "discover" && (
          <>
            <Select className="w-56" value={minScore} onChange={(e) => setMinScore(e.target.value)} aria-label="Minimum score">
              <option value="70">Strong matches (70+)</option>
              <option value="50">Good matches (50+)</option>
              <option value="">Everything</option>
            </Select>
            <Button variant="outline" onClick={() => setAdding(!adding)}><Plus /> Add a job</Button>
            <Button variant="outline" disabled={scan?.scanning} onClick={async () => { await api.scan(); setScan(await api.scanStatus()); }}>
              {scan?.scanning ? <Loader2 className="animate-spin" /> : <RefreshCw />}{scan?.scanning ? "Searching…" : "Search now"}
            </Button>
          </>
        )}
      </div>
      {kind === "discover" && scan?.scanning && <p className="text-sm text-muted-foreground">{scan.progress?.stage} · {scan.progress?.added ?? 0} new so far. New jobs appear here as they're found; refresh to see them.</p>}
      {adding && <AddJob onClose={() => setAdding(false)} onAdded={(r) => { setAdding(false); setQ(""); setAdded(r); }} />}
      {added && <p className="text-sm text-muted-foreground">{added.status !== "new"
        ? `You already have this job (${added.status}). Find it under ${["rejected", "skipped", "closed"].includes(added.status) ? "Closed" : "Applications"}.`
        : added.existing ? "You already had this job, so it's opened below." : "Added. It's scored and opened below, and stays in Discover whatever its score."}</p>}
      {rows === null ? <p className="text-sm text-muted-foreground">Loading…</p>
        : rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{kind === "discover" ? "No new jobs at this score. Try 'Everything', or search now." : kind === "applications" ? "Nothing here yet. Shortlist jobs from Discover." : "Nothing closed yet."}</p>
        : rows.map((r) => <JobCard key={`${r.id}-${r.status}-${focus === r.id}`} row={r} onChange={load} defaultOpen={focus === r.id} />)}
    </div>
  );
}

const MODES: Record<string, string> = { unknown: "Not stated", remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };

/** Paste a link → the ad is read from the site → check the preview → add. Blocked sites fall back to pasting the ad. */
function AddJob({ onAdded, onClose }: { onAdded: (r: { id: number; existing: boolean; status: string }) => void; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "read" | "add">("");
  const [problem, setProblem] = useState<{ error: string; paste: boolean } | null>(null);
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [via, setVia] = useState("");
  const [full, setFull] = useState(false);
  const set = (k: keyof JobDraft) => (e: { target: { value: string } }) => setDraft((d) => d && { ...d, [k]: e.target.value });

  const read = async (body: { url?: string; text?: string }) => {
    setBusy("read"); setProblem(null);
    try {
      const r = await api.fetchJob(body);
      if (r.ok) { setDraft({ ...r.job, url: r.job.url || url.trim() }); setVia(r.via); setFull(false); }
      else setProblem({ error: r.error, paste: true });
    } catch (e) { setProblem({ error: (e as Error).message, paste: true }); }
    finally { setBusy(""); }
  };
  const add = async () => {
    if (!draft) return;
    setBusy("add");
    try { onAdded(await api.addJob(draft)); }
    catch (e) { setProblem({ error: (e as Error).message, paste: false }); setBusy(""); }
  };

  return (
    <Card>
      <CardContent className="grid gap-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Add a job you found elsewhere</p>
            <p className="text-sm text-muted-foreground">Paste the link to the ad. The details are read from the site and it's scored like everything else.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) { setDraft(null); read({ url }); } }}>
          <Input className="min-w-64 flex-1" autoFocus placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link to the job ad" />
          <Button type="submit" disabled={!url.trim() || !!busy}>{busy === "read" ? <Loader2 className="animate-spin" /> : <Link2 />}Read job</Button>
        </form>
        {busy === "read" && <p className="text-sm text-muted-foreground">Reading the ad. Most sites take a couple of seconds; pages the AI has to read take up to a minute.</p>}

        {problem && (
          <div className="grid gap-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
            <p>{problem.error}</p>
            {problem.paste && (
              <>
                <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Open the ad in your browser, select all the text (title, company and description) and paste it here" />
                <Button className="w-fit" variant="outline" disabled={text.trim().length < 200 || !!busy} onClick={() => read({ url, text })}>
                  {busy === "read" ? <Loader2 className="animate-spin" /> : <ClipboardPaste />}Read pasted ad
                </Button>
              </>
            )}
          </div>
        )}

        {draft && (
          <div className="grid gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">Read from <strong className="text-foreground">{via}</strong>. Check it and fix anything that's off.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Job title"><Input value={draft.title} onChange={set("title")} /></Field>
              <Field label="Company"><Input value={draft.company} onChange={set("company")} /></Field>
              <Field label="Location"><Input value={draft.location ?? ""} onChange={set("location")} /></Field>
              <Field label="Working pattern">
                <Select value={draft.work_mode ?? "unknown"} onChange={set("work_mode")}>
                  {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Salary" hint="As written in the ad. Leave empty if it isn't stated."><Input value={draft.salary_text ?? ""} onChange={set("salary_text")} /></Field>
            </div>
            <Field label={`Description (${(draft.description ?? "").length.toLocaleString()} characters)`}>
              {full
                ? <Textarea rows={12} value={draft.description ?? ""} onChange={set("description")} />
                : <div className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed text-muted-foreground">
                    <p className="line-clamp-4 whitespace-pre-line">{draft.description || "No description found."}</p>
                    <button type="button" className="mt-1 text-primary hover:underline" onClick={() => setFull(true)}>Show and edit all</button>
                  </div>}
            </Field>
            <div className="flex items-center gap-3">
              <Button disabled={!draft.title.trim() || !draft.company.trim() || !!busy} onClick={add}>{busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />}Add and score</Button>
              {problem && !problem.paste && <span className="text-sm text-destructive">{problem.error}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type JobRow, type ScanStatus } from "@/api";
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

export function Jobs({ kind, focus }: { kind: ListKind; focus: number | null }) {
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState("50");
  const [country, setCountry] = useState("");
  const [adding, setAdding] = useState(false);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const load = useCallback(async () => {
    const p: Record<string, string> = { status: QUERY[kind].status };
    if (q) p.q = q;
    if (kind === "discover" && minScore) p.minScore = minScore;
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
      {adding && <AddJob onDone={() => { setAdding(false); load(); }} />}
      {rows === null ? <p className="text-sm text-muted-foreground">Loading…</p>
        : rows.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">{kind === "discover" ? "No new jobs at this score. Try 'Everything', or search now." : kind === "applications" ? "Nothing here yet. Shortlist jobs from Discover." : "Nothing closed yet."}</p>
        : rows.map((r) => <JobCard key={`${r.id}-${r.status}-${focus === r.id}`} row={r} onChange={load} defaultOpen={focus === r.id} />)}
    </div>
  );
}

function AddJob({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ url: "", title: "", company: "", location: "", salary_text: "", description: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <CardContent className="grid gap-3 pt-5">
        <p className="text-sm font-medium">Add a job you found elsewhere (Indeed, a company site, a referral…). It's scored like everything else.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Link to the ad"><Input value={f.url} onChange={set("url")} /></Field>
          <Field label="Job title"><Input value={f.title} onChange={set("title")} /></Field>
          <Field label="Company"><Input value={f.company} onChange={set("company")} /></Field>
          <Field label="Location / remote"><Input value={f.location} onChange={set("location")} /></Field>
          <Field label="Salary (optional)"><Input value={f.salary_text} onChange={set("salary_text")} /></Field>
        </div>
        <Field label="Full job description"><Textarea rows={6} value={f.description} onChange={set("description")} /></Field>
        <Button className="w-fit" disabled={!f.url || !f.title || !f.company} onClick={async () => {
          await api.addJob({ ...f, work_mode: /remote/i.test(f.location) ? "remote" : /hybrid/i.test(f.location) ? "hybrid" : "unknown" });
          onDone();
        }}>Add and score</Button>
      </CardContent>
    </Card>
  );
}

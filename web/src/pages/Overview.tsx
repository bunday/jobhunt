import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Overview as OverviewData } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ago, cn, plural } from "@/lib/utils";

const STAGES = [
  { key: "shortlisted", label: "Shortlisted" }, { key: "tailoring", label: "Prepared" }, { key: "applied", label: "Applied" },
  { key: "interview", label: "Interview" }, { key: "offer", label: "Offer" }, { key: "rejected", label: "Rejected" },
];
const TONE: Record<string, "neutral" | "info" | "good" | "bad"> = { shortlisted: "neutral", tailoring: "info", applied: "info", interview: "good", offer: "good", rejected: "bad" };

export function Overview({ go, openJob }: { go: (tab: string) => void; openJob: (id: number) => void }) {
  const [o, setO] = useState<OverviewData | null>(null);
  const load = () => api.overview().then(setO);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  if (!o) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const c = (k: string) => o.counts[k] ?? 0;
  const applied = c("applied") + c("interview") + c("offer") + c("rejected");
  const prep = c("shortlisted") + c("tailoring");
  const story = applied === 0
    ? `No applications sent yet. ${plural(prep, "job")} shortlisted.`
    : `You've applied to ${plural(applied, "job")}: ${c("applied")} awaiting a reply, ${plural(c("interview"), "interview")}, ${plural(c("offer"), "offer")}, ${plural(c("rejected"), "rejection")}.${prep ? ` ${prep} more shortlisted.` : ""}`;
  const sent = o.applications.filter((a) => !["shortlisted", "tailoring"].includes(a.status));
  const preparing = o.applications.filter((a) => ["shortlisted", "tailoring"].includes(a.status));
  const Row = (a: OverviewData["applications"][number]) => (
    <button key={a.id} type="button" onClick={() => openJob(a.id)} className="grid w-full cursor-pointer grid-cols-[2.25rem_6.5rem_1fr] items-center gap-3 border-t px-1 py-2.5 text-left first:border-t-0 hover:bg-muted/60 sm:grid-cols-[2.25rem_6.5rem_1fr_13rem_7rem]">
      <span className="text-sm font-semibold tabular-nums text-muted-foreground">{a.score}</span>
      <Badge tone={TONE[a.status]}>{STAGES.find((s) => s.key === a.status)?.label ?? a.status}</Badge>
      <span className="truncate text-sm"><strong className="font-medium">{a.company}</strong> <span className="text-muted-foreground">· {a.title}</span></span>
      <span className="hidden truncate text-xs text-muted-foreground sm:block">{a.last_event}</span>
      <span className="hidden text-right text-xs text-muted-foreground sm:block">{a.applied_at ? `applied ${ago(a.applied_at)}` : ago(a.updated_at)}</span>
    </button>
  );
  return (
    <div className="grid gap-5">
      <p className="text-lg font-medium">{story}</p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {STAGES.map((s) => (
          <button key={s.key} type="button" onClick={() => go(s.key === "rejected" ? "closed" : "applications")} className="cursor-pointer rounded-lg border bg-card p-3 text-center shadow-xs hover:bg-muted/50">
            <div className={cn("text-2xl font-semibold tabular-nums", s.key === "offer" || s.key === "interview" ? "text-success" : s.key === "rejected" ? "text-destructive" : "text-foreground")}>{c(s.key)}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </button>
        ))}
      </div>
      {o.attention.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Needs your attention</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm">
              {o.attention.map((x) => (
                <li key={x.text}><button type="button" className="cursor-pointer text-left text-primary hover:underline" onClick={() => (x.job_id ? openJob(x.job_id) : go("applications"))}>{x.text}</button></li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Your applications {sent.length ? `(${sent.length})` : ""}</CardTitle></CardHeader>
        <CardContent>{sent.length ? sent.map(Row) : <p className="text-sm text-muted-foreground">Nothing sent yet. Shortlist a job in Discover, prepare it, then apply.</p>}</CardContent>
      </Card>
      {preparing.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Shortlisted ({preparing.length})</CardTitle></CardHeader>
          <CardContent>{preparing.map(Row)}</CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-5">
          <div className="flex-1">
            <p className="text-sm"><strong>{o.strongNew}</strong> good new matches waiting in Discover</p>
            {o.lastScan && <p className="text-xs text-muted-foreground">Last search {ago(o.lastScan.started)}: {o.lastScan.added} new of {o.lastScan.found} seen. Runs daily.</p>}
          </div>
          <Button variant="outline" onClick={() => go("discover")}>Open Discover</Button>
          <Button variant="ghost" disabled={o.scanning} onClick={async () => { await api.scan(); load(); }}>{o.scanning ? <Loader2 className="animate-spin" /> : <RefreshCw />}{o.scanning ? "Searching…" : "Search now"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}

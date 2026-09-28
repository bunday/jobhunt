import { Star } from "lucide-react";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type SetupData } from "@/api";
import { cn, setCurrency } from "@/lib/utils";
import { Jobs, type ListKind } from "@/pages/Jobs";
import { Overview } from "@/pages/Overview";
import { Settings } from "@/pages/Settings";
import { Setup } from "@/pages/Setup";
import "./index.css";

type Tab = "overview" | ListKind | "settings";
// shown in the footer; set VITE_REPO_URL at build time if you fork this
const REPO_URL = import.meta.env.VITE_REPO_URL ?? "https://github.com/bunday/jobhunt";

function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground">
        <span>Built by <a className="font-medium text-foreground hover:underline" href="https://github.com/bunday" target="_blank" rel="noreferrer">Bundayy</a></span>
        <a className="inline-flex items-center gap-1.5 hover:text-foreground" href={REPO_URL} target="_blank" rel="noreferrer">
          <Star className="size-3.5" /> Finding this useful? Leave a star on GitHub
        </a>
      </div>
    </footer>
  );
}

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" }, { key: "applications", label: "Applications" }, { key: "discover", label: "Discover" },
  { key: "closed", label: "Closed" }, { key: "settings", label: "Settings" },
];

function App() {
  const [data, setData] = useState<SetupData | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [focus, setFocus] = useState<number | null>(null);
  const load = useCallback(() => api.setup().then(setData), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  setCurrency(data.countries[data.settings.country]?.symbol ?? "£");
  if (!data.settings.setupComplete) return <div className="flex min-h-screen flex-col"><div className="flex-1"><Setup initial={data} onDone={load} /></div><Footer /></div>;
  const go = (t: string) => { setFocus(null); setTab(t as Tab); };
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4">
          <span className="py-3 font-semibold tracking-tight">Job Hunt</span>
          <nav className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => go(t.key)}
                className={cn("cursor-pointer border-b-2 px-3 py-3 text-sm whitespace-nowrap", tab === t.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
              </button>
            ))}
          </nav>
          <span className="ml-auto hidden truncate text-sm text-muted-foreground sm:block">{data.settings.name}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {tab === "overview" && <Overview go={go} openJob={(id) => { setFocus(id); setTab("applications"); }} />}
        {(tab === "applications" || tab === "discover" || tab === "closed") && <Jobs kind={tab} focus={focus} />}
        {tab === "settings" && <Settings initial={data} onSaved={load} />}
      </main>
      <Footer />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

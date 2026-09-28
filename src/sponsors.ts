// Public registers of employers licensed to sponsor work visas, one plug-in per country.
//   gb: Home Office Register of Licensed Sponsors (Skilled Worker route), CSV, updated daily
//   nl: IND public register of recognised sponsors (work), HTML table
// Other countries have no licence register, so sponsorship isn't checked there.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { DATA_DIR } from "./db";
import type { CountryCode } from "./settings";

type Entry = { name: string; detail: string };
type Register = { fetch: () => Promise<Entry[]>; aliases?: Record<string, string> };

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();

const REGISTERS: Partial<Record<CountryCode, Register>> = {
  gb: {
    async fetch() {
      const page = await (await fetch("https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers")).text();
      const url = page.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"]+\.csv/)?.[0];
      if (!url) throw new Error("UK sponsor register CSV link not found on gov.uk");
      const lines = (await (await fetch(url)).text()).split(/\r?\n/).slice(1);
      const out: Entry[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        const [name, town, , rating, route] = parseCsvLine(line);
        if (route?.includes("Skilled Worker")) out.push({ name: name.trim(), detail: `${town?.trim()}, ${rating?.trim()}` });
      }
      return out;
    },
    // brands whose UK sponsoring entity is named differently, or whose short name collides with small firms
    aliases: { apple: "apple europe limited" },
  },
  nl: {
    async fetch() {
      const html = await (await fetch("https://ind.nl/en/public-register-recognised-sponsors/public-register-work", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; jobhunt)" },
      })).text();
      const out: Entry[] = [];
      for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
        // the organisation is a row header (<th scope="row">), the KVK number a <td>
        const cells = [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => decode(c[1]));
        if (cells.length >= 2 && /^\d+$/.test(cells[1])) out.push({ name: cells[0].replace(/^"+|"+$/g, ""), detail: `KVK ${cells[1]}` });
      }
      return out;
    },
  },
};

export const hasRegister = (c: CountryCode) => !!REGISTERS[c];

const SUFFIX = /\b(limited|ltd|plc|llp|llc|inc|incorporated|corp|corporation|co|company|group|holdings?|uk|u k|gb|europe|emea|international|technologies|technology|tech|services|solutions|software|the|b ?v|n ?v|nederland|netherlands)\b/g;

export function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\.(com|io|ai|co|app|dev|tech|nl)\b/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Index = { byKey: Map<string, Entry>; compact: Map<string, string>; keys: string[]; byLegal: Map<string, Entry> };
const indexes = new Map<CountryCode, Index>();
const file = (c: CountryCode) => `${DATA_DIR}/sponsors-${c}.json`;

/** Download the country's register if it's older than 20 hours. */
export async function refreshRegister(c: CountryCode, force = false): Promise<string> {
  const reg = REGISTERS[c];
  if (!reg) return "no register for this country";
  if (!force && existsSync(file(c)) && Date.now() - statSync(file(c)).mtimeMs < 20 * 3600_000) return "fresh";
  const entries = await reg.fetch();
  if (entries.length < 1000) throw new Error(`${c} sponsor register looks truncated (${entries.length} entries)`);
  writeFileSync(file(c), JSON.stringify(entries));
  indexes.delete(c);
  return `${entries.length} sponsors`;
}

function load(c: CountryCode): Index | null {
  if (indexes.has(c)) return indexes.get(c)!;
  if (!existsSync(file(c))) return null;
  const idx: Index = { byKey: new Map(), compact: new Map(), keys: [], byLegal: new Map() };
  for (const e of JSON.parse(readFileSync(file(c), "utf8")) as Entry[]) {
    idx.byLegal.set(e.name.toLowerCase(), e);
    // "Acme Ltd T/A Widgets" → index both the legal name and the trading name
    for (const part of e.name.split(/\bt\/a\b|\btrading as\b|\bh\.?o\.?d\.?n\.?\b/i)) {
      const k = normalise(part);
      // several entities can share a key: keep the plainest name ("Checkout Ltd" over "Checkout (Wimbledon) Limited")
      if (k && (!idx.byKey.has(k) || idx.byKey.get(k)!.name.length > e.name.length)) idx.byKey.set(k, e);
      const ck = k.replace(/ /g, "");
      if (ck && !idx.compact.has(ck)) idx.compact.set(ck, k);
    }
  }
  idx.keys = [...idx.byKey.keys()];
  indexes.set(c, idx);
  return idx;
}

export type SponsorMatch = { status: "licensed" | "likely" | "not_found" | "n/a"; name?: string };

/** licensed = exact normalised match; likely = the company name is the leading words of a registered name. */
export function matchSponsor(c: CountryCode, company: string): SponsorMatch {
  const idx = load(c);
  if (!idx) return { status: "n/a" };
  const fmt = (e: Entry) => `${e.name} (${e.detail})`;
  const raw = normalise(company);
  const alias = REGISTERS[c]?.aliases?.[raw];
  if (alias) { const e = idx.byLegal.get(alias); if (e) return { status: "licensed", name: fmt(e) }; }
  if (!raw) return { status: "not_found" };
  const ck = raw.replace(/ /g, "");
  const hitKey = idx.byKey.has(raw) ? raw : idx.compact.get(ck);
  // very short names ("wise", "bold") collide with unrelated firms: never call those certain
  if (hitKey) return { status: ck.length >= 6 ? "licensed" : "likely", name: fmt(idx.byKey.get(hitKey)!) };
  if (raw.length >= 5) {
    const pre = idx.keys.find((x) => x.startsWith(`${raw} `)) ?? [...idx.compact.keys()].find((x) => x.startsWith(ck) && x.length - ck.length <= 30);
    if (pre) return { status: "likely", name: fmt(idx.byKey.get(idx.compact.get(pre) ?? pre)!) };
  }
  return { status: "not_found" };
}

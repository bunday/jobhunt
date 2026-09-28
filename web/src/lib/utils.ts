import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** Calendar days in the viewer's time zone, not 24-hour periods ("yesterday 13:27" must not read as "today"). */
export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const d = Math.round((day(new Date()) - day(then)) / 86400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type CountryInfo = { name: string; symbol: string };
/** Country names/currencies and the user's home + searched countries, set once the app loads. */
export const app = { countries: {} as Record<string, CountryInfo>, home: "gb", searched: ["gb"] as string[] };
export const setApp = (a: typeof app) => Object.assign(app, a);

/** "£90k–£120k" (in the job's own country's currency), or "£101k" when min and max are the same. */
export function moneyRange(min: number | null, max: number | null, country?: string | null): string | null {
  if (!max) return null;
  const sym = app.countries[country ?? app.home]?.symbol ?? "";
  const k = (n: number) => `${sym}${Math.round(n / 1000)}k`;
  return !min || Math.round(min / 1000) === Math.round(max / 1000) ? k(max) : `${k(min)}–${k(max)}`;
}

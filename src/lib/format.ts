export const TZ = "Africa/Dar_es_Salaam";

export function tzs(value: number | string | null | undefined, opts: { sign?: boolean } = {}) {
  const n = Number(value ?? 0);
  const abs = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = n < 0 ? "-" : opts.sign && n > 0 ? "+" : "";
  return `${sign}TZS ${abs}`;
}

export function num(value: number | string | null | undefined, digits = 0) {
  const n = Number(value ?? 0);
  const fixed = n.toFixed(digits);
  const [i, d] = fixed.split(".");
  const neg = i.startsWith("-");
  const int = (neg ? i.slice(1) : i).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${int}${d && Number(d) !== 0 ? "." + d : ""}`;
}

export function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function monthStart() {
  return today().slice(0, 8) + "01";
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  const date = new Date(d.length === 10 ? d + "T12:00:00Z" : d);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }).format(date);
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ,
  }).format(new Date(d));
}

export function fmtMonth(d: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
}

export function qty(cartons: number, bottles: number) {
  const parts = [];
  if (cartons) parts.push(`${cartons} ctn`);
  if (bottles) parts.push(`${bottles} btl`);
  return parts.join(" + ") || "0";
}

export const METHOD_LABEL: Record<string, string> = { cash: "Cash", mobile_money: "Mobile money", bank: "Bank" };

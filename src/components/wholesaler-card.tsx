import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { fmtDate, num, tzs } from "@/lib/format";
import { directionsUrl } from "@/lib/shops";
import { HEALTH_LABEL, type WholesalerMetrics } from "@/lib/wholesalers";

const ctn = (n: number | null | undefined, digits = 0) => `${num(n ?? 0, digits)} ctn`;
const ago = (days: number | null) => (days === null ? "" : days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-50 p-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

export function WholesalerCard({ r }: { r: WholesalerMetrics }) {
  const h = HEALTH_LABEL[r.health];
  const trend = r.cartonsMonth - r.cartonsPrevMonth;
  return (
    <section id={`w-${r.id}`} className="scroll-mt-20 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/customers/${r.id}`} className="block truncate text-lg font-semibold text-brand-900">{r.name}</Link>
          <div className="text-xs text-gray-500">{[r.contact_name, r.area, r.region, r.phone].filter(Boolean).join(" · ")}</div>
        </div>
        <span className="shrink-0 whitespace-nowrap"><Badge tone={h.tone}>{h.label}</Badge></span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric
          label="Est. stock now"
          value={r.estStock === null ? "—" : ctn(r.estStock, r.estStock < 10 ? 1 : 0)}
          hint={r.daysLeft === null ? "Needs 2 orders" : r.daysLeft <= 0 ? "Probably sold out" : `Lasts ~${r.daysLeft} more days`}
        />
        <Metric label="Sells per week" value={r.dailyRate === null ? "—" : ctn(r.dailyRate * 7, 1)} hint={r.dailyRate === null ? "" : `${num(r.dailyRate, 1)} a day`} />
        <Metric label="Next order" value={r.nextOrderDate ? fmtDate(r.nextOrderDate) : "—"} hint={r.avgDaysBetween ? `Orders every ~${Math.round(r.avgDaysBetween)} days` : ""} />
        <Metric label="Last order" value={r.lastPurchase ? ctn(r.lastOrderCartons, 1) : "Never"} hint={r.lastPurchase ? `${fmtDate(r.lastPurchase)} · ${ago(r.daysSinceLast)}` : ""} />
        <Metric label="Average order" value={r.orders ? ctn(r.avgOrderCartons, 1) : "—"} hint={`${r.orders} orders`} />
        <Metric
          label="This month"
          value={ctn(r.cartonsMonth, 1)}
          hint={r.cartonsPrevMonth || r.cartonsMonth ? `${trend >= 0 ? "▲" : "▼"} ${num(Math.abs(trend), 1)} vs last month` : ""}
        />
        <Metric label="Last 30 days" value={ctn(r.cartons30, 1)} />
        <Metric label="All time" value={ctn(r.cartonsTotal, 1)} hint={tzs(r.total_bought)} />
        <Metric label="Owes" value={<span className={Number(r.balance) > 0 ? "text-red-700" : ""}>{tzs(r.balance)}</span>} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/sales/new?customer=${r.id}`} className="btn-primary !px-3 !py-1.5 text-sm">New sale</Link>
        {r.phone && <a href={`tel:${r.phone}`} className="btn-secondary !px-3 !py-1.5 text-sm">Call</a>}
        {r.lat != null && r.lng != null && (
          <a href={directionsUrl(r.lat, r.lng)} target="_blank" rel="noreferrer" className="btn-secondary !px-3 !py-1.5 text-sm">Directions</a>
        )}
        <Link href={`/customers/${r.id}`} className="btn-secondary !px-3 !py-1.5 text-sm">Details</Link>
      </div>
    </section>
  );
}

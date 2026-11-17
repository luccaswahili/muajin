/** Metrics for wholesalers, worked out from their purchases. Pure functions, no database calls. */

export type Purchase = { customer_id: string; date: string; cartons: number; bottles: number; bottles_per_carton: number | null; total: number };

export type WholesalerInput = {
  id: string; name: string; phone: string | null; contact_name: string | null; region: string | null; area: string | null;
  lat: number | null; lng: number | null; balance: number; total_bought: number;
};

export type Health = "overdue" | "low" | "ok" | "new" | "never";

export type WholesalerMetrics = WholesalerInput & {
  orders: number;
  cartonsTotal: number;
  cartons30: number;
  cartonsMonth: number;
  cartonsPrevMonth: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
  lastOrderCartons: number;
  daysSinceLast: number | null;
  avgOrderCartons: number;
  avgDaysBetween: number | null;
  /** Cartons they sell per day, from how fast they used earlier orders */
  dailyRate: number | null;
  /** Rough cartons still on their shelf */
  estStock: number | null;
  /** Days until the estimate reaches zero */
  daysLeft: number | null;
  nextOrderDate: string | null;
  health: Health;
};

const DAY = 86_400_000;
const toTime = (d: string) => new Date(d + "T12:00:00Z").getTime();
const addDays = (d: string, n: number) => new Date(toTime(d) + n * DAY).toISOString().slice(0, 10);

export function wholesalerMetrics(w: WholesalerInput, purchases: Purchase[], today: string): WholesalerMetrics {
  // One order = everything bought on the same day
  const byDay = new Map<string, number>();
  for (const p of purchases) {
    const ctn = Number(p.cartons) + Number(p.bottles) / (p.bottles_per_carton || 30);
    byDay.set(p.date, (byDay.get(p.date) ?? 0) + ctn);
  }
  const orders = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const t = toTime(today);
  const sumSince = (from: string, to = "9999") => orders.filter(([d]) => d >= from && d < to).reduce((a, [, c]) => a + c, 0);
  const month = today.slice(0, 8) + "01";
  const prevMonthDate = new Date(toTime(month) - 15 * DAY).toISOString().slice(0, 8) + "01";

  const cartonsTotal = orders.reduce((a, [, c]) => a + c, 0);
  const first = orders[0]?.[0] ?? null;
  const last = orders.at(-1)?.[0] ?? null;
  const lastOrderCartons = orders.at(-1)?.[1] ?? 0;
  const daysSinceLast = last ? Math.max(0, Math.round((t - toTime(last)) / DAY)) : null;

  let avgDaysBetween: number | null = null;
  let dailyRate: number | null = null;
  if (orders.length >= 2 && first && last) {
    const span = Math.max(1, (toTime(last) - toTime(first)) / DAY);
    avgDaysBetween = span / (orders.length - 1);
    // Everything bought before the last order was used up over the span
    dailyRate = (cartonsTotal - lastOrderCartons) / span;
  }

  let estStock: number | null = null;
  let daysLeft: number | null = null;
  let nextOrderDate: string | null = null;
  if (dailyRate !== null && dailyRate > 0 && daysSinceLast !== null && last) {
    estStock = Math.max(0, lastOrderCartons - dailyRate * daysSinceLast);
    daysLeft = Math.floor(estStock / dailyRate);
    nextOrderDate = addDays(last, Math.round(lastOrderCartons / dailyRate));
  }

  let health: Health = "ok";
  if (!orders.length) health = "never";
  else if (dailyRate === null) health = daysSinceLast !== null && daysSinceLast > 30 ? "overdue" : "new";
  else if (estStock !== null && estStock <= 0) health = "overdue";
  else if (daysLeft !== null && daysLeft <= 3) health = "low";

  return {
    ...w,
    orders: orders.length,
    cartonsTotal,
    cartons30: sumSince(addDays(today, -29)),
    cartonsMonth: sumSince(month),
    cartonsPrevMonth: sumSince(prevMonthDate, month),
    firstPurchase: first,
    lastPurchase: last,
    lastOrderCartons,
    daysSinceLast,
    avgOrderCartons: orders.length ? cartonsTotal / orders.length : 0,
    avgDaysBetween,
    dailyRate,
    estStock,
    daysLeft,
    nextOrderDate,
    health,
  };
}

const ORDER: Record<Health, number> = { overdue: 0, low: 1, ok: 2, new: 3, never: 4 };

/** Who needs a visit first: out of stock, then running low, then the rest by soonest reorder. */
export function byUrgency(a: WholesalerMetrics, b: WholesalerMetrics) {
  return ORDER[a.health] - ORDER[b.health] || (a.daysLeft ?? 999) - (b.daysLeft ?? 999) || b.cartons30 - a.cartons30;
}

export const HEALTH_LABEL: Record<Health, { label: string; tone: "red" | "amber" | "green" | "blue" | "gray" }> = {
  overdue: { label: "Should have reordered", tone: "red" },
  low: { label: "Running low", tone: "amber" },
  ok: { label: "Has stock", tone: "green" },
  new: { label: "Only 1 order so far", tone: "blue" },
  never: { label: "Never bought", tone: "gray" },
};

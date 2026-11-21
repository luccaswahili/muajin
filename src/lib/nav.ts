/** Small helpers for live navigation on the Locate map. Points are { lat, lng }. */
export type Pt = { lat: number; lng: number };
export type Step = { text: string; name: string; at: Pt; idx: number; type: string; modifier: string };
export type Route = { coords: Pt[]; cum: number[]; distance: number; duration: number; steps: Step[] };
export type Mode = "foot" | "car";

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres between two points. */
export function meters(a: Pt, b: Pt) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Compass direction from a to b, in degrees (0 = north, 90 = east). */
export function bearing(a: Pt, b: Pt) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The point d metres from p in compass direction deg. */
export function ahead(p: Pt, deg: number, d: number): Pt {
  const k = d / R;
  const t = rad(deg);
  const lat = Math.asin(Math.sin(rad(p.lat)) * Math.cos(k) + Math.cos(rad(p.lat)) * Math.sin(k) * Math.cos(t));
  const lng = rad(p.lng) + Math.atan2(Math.sin(t) * Math.sin(k) * Math.cos(rad(p.lat)), Math.cos(k) - Math.sin(rad(p.lat)) * Math.sin(lat));
  return { lat: (lat * 180) / Math.PI, lng: (lng * 180) / Math.PI };
}

/** Closest point on the route to p: which segment, how far along the route, how far off it. */
export function snap(route: Route, p: Pt) {
  const { coords, cum } = route;
  let best = { idx: 0, along: 0, off: Infinity, pt: p as Pt };
  const kx = Math.cos(rad(p.lat)) * 111320;
  const ky = 110540;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * ky;
    const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const off = Math.hypot(ax + t * dx, ay + t * dy);
    if (off < best.off) best = { idx: i, along: cum[i] + t * (cum[i + 1] - cum[i]), off, pt: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) } };
  }
  return best;
}

function instruction(m: { type: string; modifier?: string; exit?: number }, name: string) {
  const onto = name ? ` onto ${name}` : "";
  const dir = (m.modifier ?? "").replace("uturn", "U-turn");
  switch (m.type) {
    case "depart": return `Start${name ? ` on ${name}` : ""}`;
    case "arrive": return "You have arrived";
    case "roundabout":
    case "rotary": return `At the roundabout take exit ${m.exit ?? 1}${onto}`;
    case "continue":
    case "new name": return `Continue${dir && dir !== "straight" ? ` ${dir}` : " straight"}${onto}`;
    case "merge": return `Merge${onto}`;
    case "fork": return `Keep ${dir || "straight"}${onto}`;
    case "end of road": return `At the end of the road turn ${dir}${onto}`;
    default:
      if (dir === "U-turn") return `Make a U-turn${onto}`;
      return dir === "straight" ? `Go straight${onto}` : `Turn ${dir}${onto}`;
  }
}

/** Ask the free OpenStreetMap routing service for a route. */
export async function fetchRoute(from: Pt, to: Pt, mode: Mode, signal?: AbortSignal): Promise<Route> {
  const profile = mode === "foot" ? "routed-foot" : "routed-car";
  const url = `https://routing.openstreetmap.de/${profile}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Route service error ${res.status}`);
  const data = await res.json();
  const r = data.routes?.[0];
  if (data.code !== "Ok" || !r) throw new Error("No route found");
  const coords: Pt[] = r.geometry.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng }));
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + meters(coords[i - 1], coords[i]));
  const route: Route = { coords, cum, distance: r.distance, duration: r.duration, steps: [] };
  for (const leg of r.legs ?? []) {
    for (const s of leg.steps ?? []) {
      const at = { lat: s.maneuver.location[1], lng: s.maneuver.location[0] };
      route.steps.push({ text: instruction(s.maneuver, s.name), name: s.name, at, idx: snap(route, at).idx, type: s.maneuver.type, modifier: s.maneuver.modifier ?? "" });
    }
  }
  return route;
}

/** A circle of radius r metres around c, as a closed ring of [lng, lat] points. */
export function circleRing(c: Pt, r: number, n = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const q = ahead(c, (i * 360) / n, r);
    ring.push([q.lng, q.lat]);
  }
  return ring;
}

export function fmtMeters(m: number) {
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** Clock time after sec seconds from now, like 10:34 AM. */
export function arrivalTime(sec: number) {
  return new Date(Date.now() + sec * 1000).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
}

export function fmtMinutes(sec: number) {
  const min = Math.max(1, Math.round(sec / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Phone number as WhatsApp wants it (Tanzania numbers get 255 in front). */
export function waNumber(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("255")) return d;
  if (d.startsWith("0")) return "255" + d.slice(1);
  return d.length === 9 ? "255" + d : d;
}

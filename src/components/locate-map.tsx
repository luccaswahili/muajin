"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type * as Leaflet from "leaflet";
import { loadLeaflet, ROTATE_OPTIONS } from "@/lib/load-leaflet";
import { CompassButton } from "@/components/compass-button";
import { fmtDate, tzs } from "@/lib/format";
import { withRef } from "@/lib/shops";
import { fetchRoute, fmtMeters, fmtMinutes, meters, snap, waNumber, type Mode, type Pt, type Route } from "@/lib/nav";

export type LocateCustomer = {
  id: string; name: string; contact_name: string | null; phone: string | null; area: string | null;
  lat: number; lng: number; balance: number; last_purchase: string | null;
  /** Date of the oldest sale not fully paid */
  owing_since: string | null;
  last_payment: string | null;
};

type Me = Pt & { acc: number };
type Sort = "near" | "big" | "old";

const DAR: Pt = { lat: -6.7924, lng: 39.2083 };
const RADII = [0.5, 1, 2, 3, 4, 5];
const ARRIVE_M = 35;

const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);
const daysSince = (d: string | null, today: string) =>
  d ? Math.max(0, Math.round((new Date(today + "T12:00:00Z").getTime() - new Date(d + "T12:00:00Z").getTime()) / 86_400_000)) : null;

function pin(owes: boolean, label: string, big: boolean) {
  const bg = owes ? "#dc2626" : "#16654a";
  const size = big ? 22 : 16;
  const tag = owes && label
    ? `<div style="position:absolute;left:${size + 2}px;top:-2px;white-space:nowrap;background:#fff;color:#991b1b;font:600 11px/1.4 system-ui;padding:0 5px;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,.35)">${label}</div>`
    : "";
  return `<div style="position:relative;width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:3px solid ${big ? "#111" : "#fff"};box-shadow:0 1px 4px rgba(0,0,0,.4)">${tag}</div>`;
}

export function LocateMap({ customers, isAgent, today, unlocatedDebtors }: {
  customers: LocateCustomer[]; isAgent: boolean; today: string; unlocatedDebtors: { count: number; total: number };
}) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const shopLayer = useRef<Leaflet.LayerGroup | null>(null);
  const meLayer = useRef<Leaflet.LayerGroup | null>(null);
  const routeLayer = useRef<Leaflet.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const [mapObj, setMapObj] = useState<Leaflet.Map | null>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [geoError, setGeoError] = useState("");
  const [owesOnly, setOwesOnly] = useState(false);
  const [radius, setRadius] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("near");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  // Navigation
  const [target, setTarget] = useState<LocateCustomer | null>(null);
  const [mode, setMode] = useState<Mode>("foot");
  const [route, setRoute] = useState<Route | null>(null);
  const [routing, setRouting] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [follow, setFollow] = useState(true);
  const [arrived, setArrived] = useState(false);
  const lastRoute = useRef<{ at: number; from: Pt } | null>(null);
  const routeAbort = useRef<AbortController | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const followRef = useRef(true);
  const targetRef = useRef<LocateCustomer | null>(null);
  useEffect(() => {
    followRef.current = follow;
    targetRef.current = target;
  }, [follow, target]);

  const owedTo = isAgent ? "Owe you" : "Owe Muwa Gin";

  // Map
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await loadLeaflet();
      if (cancelled || !el.current || map.current) return;
      L.current = lib;
      const m = lib.map(el.current, { zoomControl: false, ...ROTATE_OPTIONS }).setView([DAR.lat, DAR.lng], 12);
      lib.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      lib.control.zoom({ position: "topright" }).addTo(m);
      routeLayer.current = lib.layerGroup().addTo(m);
      shopLayer.current = lib.layerGroup().addTo(m);
      meLayer.current = lib.layerGroup().addTo(m);
      m.on("dragstart", () => setFollow(false));
      m.on("click", () => setSelected(null));
      map.current = m;
      setMapObj(m);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Live location, always on while this page is open
  useEffect(() => {
    if (!navigator.geolocation) {
      const t = setTimeout(() => setGeoError("This phone/browser cannot share location."), 0);
      return () => clearTimeout(t);
    }
    let first = true;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
        setMe(p);
        setGeoError("");
        const tg = targetRef.current;
        if (tg && meters(p, tg) <= ARRIVE_M) {
          setArrived((was) => {
            if (!was && "vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
            return true;
          });
        }
        if (first) {
          first = false;
          map.current?.setView([p.lat, p.lng], 15);
        }
      },
      (err) =>
        setGeoError(err.code === 1 ? "Location is blocked. Allow location for this site in your browser settings." : "Looking for your location… go outside if it takes long."),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Which customers to show
  const withDist = useMemo(
    () => customers.map((c) => ({ ...c, dist: me ? meters(me, c) : null, owes: Number(c.balance) > 0 })),
    [customers, me],
  );
  const visible = useMemo(() => {
    const list = withDist.filter((c) => (!owesOnly || c.owes) && (radius === null || (c.dist !== null && c.dist <= radius * 1000)));
    const age = (c: LocateCustomer) => daysSince(c.owing_since, today) ?? -1;
    return list.sort((a, b) =>
      sort === "big" ? Number(b.balance) - Number(a.balance)
      : sort === "old" ? age(b) - age(a)
      : (a.dist ?? 1e12) - (b.dist ?? 1e12),
    );
  }, [withDist, owesOnly, radius, sort, today]);

  const debtors = visible.filter((c) => c.owes);
  const owedSum = debtors.reduce((a, c) => a + Number(c.balance), 0);
  const oldest = debtors.reduce<{ c: (typeof debtors)[number]; days: number } | null>((best, c) => {
    const d = daysSince(c.owing_since, today);
    return d !== null && (!best || d > best.days) ? { c, days: d } : best;
  }, null);
  const nearestDebtor = me ? [...debtors].sort((a, b) => (a.dist ?? 1e12) - (b.dist ?? 1e12))[0] : undefined;
  const biggest = [...debtors].sort((a, b) => Number(b.balance) - Number(a.balance))[0];

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const digits = q.replace(/\D/g, "");
    return withDist
      .filter((c) =>
        q.split(/\s+/).every((w) =>
          [c.name, c.contact_name, c.area].some((f) => (f ?? "").toLowerCase().includes(w)) ||
          (digits.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(digits)),
        ),
      )
      .slice(0, 8);
  }, [query, withDist]);

  // Markers
  useEffect(() => {
    const lib = L.current;
    if (!ready || !lib || !shopLayer.current) return;
    shopLayer.current.clearLayers();
    const show = target ? visible.filter((c) => c.id === target.id) : visible;
    for (const c of show) {
      const big = c.id === selected || c.id === target?.id;
      lib.marker([c.lat, c.lng], {
        icon: lib.divIcon({ html: pin(c.owes, c.owes ? short(Number(c.balance)) : "", big), className: "", iconSize: [big ? 22 : 16, big ? 22 : 16] }),
        zIndexOffset: big ? 1000 : c.owes ? 500 : 0,
      })
        .on("click", () => {
          if (!target) setSelected(c.id);
        })
        .addTo(shopLayer.current);
    }
  }, [ready, visible, selected, target]);

  // Me, radius circle
  useEffect(() => {
    const lib = L.current;
    if (!ready || !lib || !meLayer.current) return;
    meLayer.current.clearLayers();
    if (!me) return;
    if (radius && !target) {
      lib.circle([me.lat, me.lng], { radius: radius * 1000, color: "#16654a", weight: 1.5, dashArray: "6 6", fillOpacity: 0.04, interactive: false }).addTo(meLayer.current);
    }
    lib.circle([me.lat, me.lng], { radius: me.acc, color: "#2563eb", weight: 1, fillOpacity: 0.1, interactive: false }).addTo(meLayer.current);
    lib.marker([me.lat, me.lng], {
      icon: lib.divIcon({ html: `<div style="width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>`, className: "", iconSize: [18, 18] }),
      interactive: false,
      zIndexOffset: 2000,
    }).addTo(meLayer.current);
  }, [ready, me, radius, target]);

  // Fit the radius on screen when it changes
  useEffect(() => {
    const lib = L.current;
    if (!ready || !lib || !map.current || !me || !radius || target) return;
    map.current.fitBounds(lib.latLng(me.lat, me.lng).toBounds(radius * 2000), { padding: [20, 20] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, radius]);

  const sel = withDist.find((c) => c.id === selected) ?? null;

  function focus(c: LocateCustomer) {
    setSelected(c.id);
    setShowList(false);
    setSearchOpen(false);
    setQuery("");
    map.current?.flyTo([c.lat, c.lng], 17, { duration: 0.7 });
  }

  // ---------------------------------------------------------------- navigation
  const loadRoute = useCallback(async (from: Pt, to: LocateCustomer, how: Mode) => {
    routeAbort.current?.abort();
    const ac = new AbortController();
    routeAbort.current = ac;
    setRouting(true);
    try {
      const r = await fetchRoute(from, to, how, ac.signal);
      setRoute(r);
      setRouteError("");
      lastRoute.current = { at: Date.now(), from };
    } catch (e) {
      if ((e as Error).name !== "AbortError") setRouteError("Could not get a route right now. Showing a straight line; it will try again as you move.");
      lastRoute.current = { at: Date.now(), from };
    } finally {
      if (!ac.signal.aborted) setRouting(false);
    }
  }, []);

  async function go(c: LocateCustomer) {
    setTarget(c);
    setSelected(null);
    setShowList(false);
    setArrived(false);
    setRoute(null);
    setFollow(true);
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      /* screen may still turn off */
    }
    if (me) {
      map.current?.setView([me.lat, me.lng], 17);
      loadRoute(me, c, mode);
    }
  }

  function stop() {
    routeAbort.current?.abort();
    setTarget(null);
    setRoute(null);
    setRouteError("");
    setArrived(false);
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    routeLayer.current?.clearLayers();
  }

  // Release the screen lock when leaving the page
  useEffect(() => () => {
    wakeLock.current?.release().catch(() => {});
  }, []);

  // Progress along the route as I move
  const progress = useMemo(() => {
    if (!target || !me) return null;
    const straight = meters(me, target);
    if (!route) return { left: straight, secs: null as number | null, off: 0, idx: 0, next: null as null | { text: string; in: number }, straight };
    const s = snap(route, me);
    const left = Math.max(0, route.distance - s.along) + (s.off > 30 ? s.off : 0);
    const speed = route.duration > 0 ? route.distance / route.duration : 1.3;
    const nextStep = route.steps.find((st) => st.idx > s.idx && route.cum[st.idx] > s.along + 5);
    return {
      left,
      secs: left / speed,
      off: s.off,
      idx: s.idx,
      next: nextStep ? { text: nextStep.text, in: route.cum[nextStep.idx] - s.along } : null,
      straight,
    };
  }, [target, me, route]);

  // Arrive, re-route when off the path, follow me
  useEffect(() => {
    if (!target || !me || !progress) return;
    if (followRef.current) map.current?.panTo([me.lat, me.lng], { animate: true });
    if (arrived || routing) return;
    const last = lastRoute.current;
    const since = last ? Date.now() - last.at : Infinity;
    const movedFromLast = last ? meters(last.from, me) : Infinity;
    const offRoute = route ? progress.off > 45 : true;
    if ((offRoute && since > 12_000 && movedFromLast > 25) || (since > 120_000 && movedFromLast > 150)) {
      loadRoute(me, target, mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // Draw the route still ahead of me
  useEffect(() => {
    const lib = L.current;
    if (!ready || !lib || !routeLayer.current) return;
    routeLayer.current.clearLayers();
    if (!target) return;
    if (!route) {
      if (me) lib.polyline([[me.lat, me.lng], [target.lat, target.lng]], { color: "#2563eb", weight: 4, dashArray: "8 8", opacity: 0.7 }).addTo(routeLayer.current);
      return;
    }
    const idx = progress?.idx ?? 0;
    const ahead = route.coords.slice(idx + 1).map((p) => [p.lat, p.lng] as [number, number]);
    const start: [number, number] = me ? [me.lat, me.lng] : [route.coords[idx].lat, route.coords[idx].lng];
    lib.polyline([start, ...ahead], { color: "#1d4ed8", weight: 9, opacity: 0.25 }).addTo(routeLayer.current);
    lib.polyline([start, ...ahead], { color: "#2563eb", weight: 5, opacity: 0.95 }).addTo(routeLayer.current);
  }, [ready, route, target, me, progress?.idx]);

  function changeMode(m: Mode) {
    setMode(m);
    if (target && me) loadRoute(me, target, m);
  }

  function overview() {
    const lib = L.current;
    if (!lib || !map.current || !target) return;
    setFollow(false);
    const pts: [number, number][] = route ? route.coords.map((p) => [p.lat, p.lng]) : [[target.lat, target.lng]];
    if (me) pts.push([me.lat, me.lng]);
    map.current.fitBounds(lib.latLngBounds(pts), { padding: [40, 40] });
  }

  function reminderText(c: LocateCustomer) {
    return `Habari ${c.name}, hii ni Muwa Gin. Salio lako ni ${tzs(c.balance)}. Tafadhali lipa mapema. Asante!`;
  }

  // ---------------------------------------------------------------- view
  return (
    <div className="relative isolate -mx-4 -mt-4 h-[calc(100dvh-8.75rem)] overflow-hidden md:mx-0 md:mt-0 md:h-[calc(100dvh-7rem)] md:rounded-2xl md:border md:border-gray-200">
      <div ref={el} className="absolute inset-0 z-0 bg-gray-100" />

      {!target && (
        <div className="absolute inset-x-2 top-2 z-[1000] space-y-1.5">
          {/* Search */}
          <div className="relative">
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search customer, reference, phone or area"
              className="input !rounded-full !py-2 pr-9 shadow-lg"
            />
            {query && (
              <button onClick={() => { setQuery(""); setSearchOpen(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-lg text-gray-400" aria-label="Clear">×</button>
            )}
            {searchOpen && query.trim() && (
              <div className="absolute inset-x-0 top-full mt-1 max-h-72 overflow-y-auto rounded-xl bg-white shadow-xl">
                {hits.length ? hits.map((c) => (
                  <button key={c.id} onClick={() => focus(c)} className="flex w-full items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 text-left last:border-0">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{withRef(c.name, c.contact_name)}</span>
                      <span className="block text-xs text-gray-500">{[c.area, c.dist !== null ? fmtMeters(c.dist) : ""].filter(Boolean).join(" · ")}</span>
                    </span>
                    {c.owes && <span className="shrink-0 text-xs font-semibold text-red-700">{tzs(c.balance)}</span>}
                  </button>
                )) : <div className="px-3 py-3 text-sm text-gray-500">No customer on the map matches.</div>}
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="-mx-2 flex gap-1.5 overflow-x-auto px-2 pb-1 [scrollbar-width:none]">
            <button
              onClick={() => setOwesOnly((v) => !v)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold shadow ${owesOnly ? "bg-red-600 text-white" : "bg-white text-gray-800"}`}
            >
              {owesOnly ? "✓ " : ""}{owedTo}
            </button>
            <button
              onClick={() => setRadius(null)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium shadow ${radius === null ? "bg-brand-600 text-white" : "bg-white text-gray-800"}`}
            >
              Any distance
            </button>
            {RADII.map((r) => (
              <button
                key={r}
                onClick={() => setRadius(r)}
                disabled={!me}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium shadow disabled:opacity-40 ${radius === r ? "bg-brand-600 text-white" : "bg-white text-gray-800"}`}
              >
                {r < 1 ? `${r * 1000} m` : `${r} km`}
              </button>
            ))}
          </div>

          {/* Summary */}
          <button onClick={() => setShowList(true)} className="block w-full rounded-xl bg-white/95 px-3 py-2 text-left shadow-lg">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-gray-500">
                {visible.length} customer{visible.length === 1 ? "" : "s"}
                {radius ? ` within ${radius < 1 ? `${radius * 1000} m` : `${radius} km`}` : ""}
                {` · ${debtors.length} owe`}
              </span>
              <span className="text-xs font-medium text-brand-700">List ›</span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-bold tabular-nums text-red-700">{tzs(owedSum)}</span>
              <span className="text-[11px] text-gray-500">owed by the customers shown</span>
            </div>
            {debtors.length > 0 && (
              <div className="mt-0.5 truncate text-[11px] text-gray-600">
                {nearestDebtor?.dist != null && <>Nearest: <b>{nearestDebtor.name}</b> {fmtMeters(nearestDebtor.dist)} · </>}
                {biggest && <>Biggest: <b>{short(Number(biggest.balance))}</b> · </>}
                {oldest && <>Oldest: <b>{oldest.days} days</b></>}
              </div>
            )}
          </button>
          {geoError && <div className="rounded-xl bg-amber-50 p-2 text-xs text-amber-900 shadow">{geoError}</div>}
        </div>
      )}

      {/* Buttons on the right */}
      <div className="absolute bottom-4 right-3 z-[1000] flex flex-col items-end gap-2">
        <CompassButton map={mapObj} />
        {target && (
          <button onClick={overview} className="grid h-12 w-12 place-items-center rounded-full bg-white text-lg shadow-lg" aria-label="See whole route">🗺️</button>
        )}
        <button
          onClick={() => { setFollow(true); if (me) map.current?.flyTo([me.lat, me.lng], target ? 17 : Math.max(map.current?.getZoom() ?? 15, 15), { duration: 0.6 }); }}
          className={`grid h-12 w-12 place-items-center rounded-full text-xl shadow-lg ${follow && target ? "bg-blue-600 text-white" : "bg-white"}`}
          aria-label="Go to my location"
        >
          ◎
        </button>
      </div>

      {!target && !sel && !showList && (
        <div className="absolute bottom-4 left-3 right-20 z-[1000] flex gap-2">
          <Link href="/map" className="btn-secondary shadow-lg">← Map</Link>
          <button onClick={() => setShowList(true)} className="btn-primary flex-1 shadow-lg">List ({visible.length})</button>
        </div>
      )}

      {/* List */}
      {showList && !target && (
        <div className="absolute inset-x-0 bottom-0 z-[1001] flex max-h-[65%] flex-col rounded-t-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 p-3">
            <div className="flex gap-1 text-xs">
              {([["near", "Nearest"], ["big", "Biggest debt"], ["old", "Oldest debt"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setSort(k)} className={`rounded-full px-2.5 py-1 font-medium ${sort === k ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700"}`}>{label}</button>
              ))}
            </div>
            <button onClick={() => setShowList(false)} className="text-sm text-gray-500">Close</button>
          </div>
          <div className="overflow-y-auto px-3">
            {visible.length ? visible.map((c) => {
              const age = daysSince(c.owing_since, today);
              return (
                <button key={c.id} onClick={() => focus(c)} className="flex w-full items-center justify-between gap-3 border-b border-gray-100 py-2.5 text-left last:border-0">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{withRef(c.name, c.contact_name)}</span>
                    <span className="block text-xs text-gray-500">
                      {[c.dist !== null ? fmtMeters(c.dist) : "", c.area, c.owes && age !== null ? `owing ${age} days` : ""].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${c.owes ? "text-red-700" : "text-gray-400"}`}>{c.owes ? tzs(c.balance) : "Paid up"}</span>
                </button>
              );
            }) : <p className="py-6 text-center text-sm text-gray-500">No customers match these filters.</p>}
            {unlocatedDebtors.count > 0 && (
              <p className="py-3 text-xs text-gray-500">
                {unlocatedDebtors.count} more customer{unlocatedDebtors.count === 1 ? "" : "s"} owe {tzs(unlocatedDebtors.total)} but are not on the map yet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Selected customer */}
      {sel && !target && (
        <div className="absolute inset-x-0 bottom-0 z-[1001] rounded-t-2xl bg-white p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">{withRef(sel.name, sel.contact_name)}</div>
              <div className="text-xs text-gray-500">
                {[sel.area, sel.dist !== null ? `${fmtMeters(sel.dist)} away` : "", sel.phone].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-xl text-gray-400">×</button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-red-50 p-2">
              <div className="text-[11px] text-red-800">Owes</div>
              <div className={`text-sm font-bold tabular-nums ${sel.owes ? "text-red-700" : "text-gray-500"}`}>{sel.owes ? tzs(sel.balance) : "Nothing"}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-2">
              <div className="text-[11px] text-gray-500">Owing since</div>
              <div className="text-sm font-semibold">{sel.owes && sel.owing_since ? `${daysSince(sel.owing_since, today)} days` : "—"}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-2">
              <div className="text-[11px] text-gray-500">Last paid</div>
              <div className="text-sm font-semibold">{sel.last_payment ? fmtDate(sel.last_payment).replace(/ \d{4}$/, "") : "Never"}</div>
            </div>
          </div>
          <button onClick={() => go(sel)} disabled={!me} className="btn-primary mt-3 w-full text-base disabled:opacity-50">
            {me ? `Go · ${fmtMeters(sel.dist ?? 0)}` : "Waiting for your location…"}
          </button>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs font-medium">
            {sel.phone ? <a href={`tel:${sel.phone}`} className="rounded-xl bg-brand-50 p-2 text-brand-700">📞<br />Call</a> : <span className="rounded-xl bg-gray-50 p-2 text-gray-400">📞<br />No phone</span>}
            {sel.phone && sel.owes ? (
              <a href={`https://wa.me/${waNumber(sel.phone)}?text=${encodeURIComponent(reminderText(sel))}`} target="_blank" rel="noreferrer" className="rounded-xl bg-brand-50 p-2 text-brand-700">💬<br />Remind</a>
            ) : <span className="rounded-xl bg-gray-50 p-2 text-gray-400">💬<br />Remind</span>}
            <Link href={`/customers/${sel.id}`} className="rounded-xl bg-brand-50 p-2 text-brand-700">💵<br />Payment</Link>
            <Link href={`/sales/new?customer=${sel.id}`} className="rounded-xl bg-brand-50 p-2 text-brand-700">🛒<br />Sell</Link>
          </div>
        </div>
      )}

      {/* Navigating */}
      {target && (
        <>
          <div className="absolute inset-x-2 top-2 z-[1000] rounded-2xl bg-brand-700 p-3 text-white shadow-xl">
            {arrived ? (
              <div className="text-lg font-bold">You have arrived 🎉</div>
            ) : progress?.next ? (
              <>
                <div className="text-2xl font-bold tabular-nums">{fmtMeters(progress.next.in)}</div>
                <div className="text-sm leading-snug">{progress.next.text}</div>
              </>
            ) : (
              <div className="text-sm">{routing ? "Finding the best way…" : `Head to ${target.name}`}</div>
            )}
            {routeError && <div className="mt-1 text-xs text-amber-200">{routeError}</div>}
          </div>

          <div className="absolute inset-x-0 bottom-0 z-[1001] rounded-t-2xl bg-white p-4 pr-20 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold">{withRef(target.name, target.contact_name)}</div>
                <div className="text-sm">
                  <b className="tabular-nums">{progress ? fmtMeters(progress.left) : "…"}</b>
                  {progress?.secs != null && !arrived && <span className="text-gray-500"> · {fmtMinutes(progress.secs)}</span>}
                  {Number(target.balance) > 0 && <span className="ml-1 font-semibold text-red-700">· owes {tzs(target.balance)}</span>}
                </div>
              </div>
            </div>
            {arrived ? (
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-medium">
                <Link href={`/customers/${target.id}`} className="rounded-xl bg-brand-600 p-2 text-white">💵<br />Payment</Link>
                <Link href={`/sales/new?customer=${target.id}`} className="rounded-xl bg-brand-50 p-2 text-brand-700">🛒<br />Sell</Link>
                <button onClick={stop} className="rounded-xl bg-gray-100 p-2 text-gray-700">✓<br />Done</button>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <div className="flex overflow-hidden rounded-xl border border-gray-200 text-sm">
                  <button onClick={() => changeMode("foot")} className={`px-3 py-2 ${mode === "foot" ? "bg-brand-600 text-white" : ""}`}>🚶 Walk</button>
                  <button onClick={() => changeMode("car")} className={`px-3 py-2 ${mode === "car" ? "bg-brand-600 text-white" : ""}`}>🛵 Ride</button>
                </div>
                <button onClick={stop} className="btn-secondary flex-1 !text-red-700">End</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

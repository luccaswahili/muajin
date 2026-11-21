"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type * as Leaflet from "leaflet";
import { addBaseTiles, loadLeaflet, meDotHtml, navArrowHtml, ROTATE_OPTIONS, teardropHtml } from "@/lib/load-leaflet";
import { TurnIcon } from "@/components/turn-icon";
import { LocateIcon } from "@/components/locate-icon";
import { CompassButton } from "@/components/compass-button";
import { fmtDate, tzs } from "@/lib/format";
import { withRef } from "@/lib/shops";
import { ahead, arrivalTime, bearing, fetchRoute, fmtMeters, fmtMinutes, meters, snap, waNumber, type Mode, type Pt, type Route } from "@/lib/nav";

export type LocateCustomer = {
  id: string; name: string; contact_name: string | null; phone: string | null; area: string | null;
  lat: number; lng: number; balance: number; last_purchase: string | null;
  /** Date of the oldest sale not fully paid */
  owing_since: string | null;
  last_payment: string | null;
};

type Me = Pt & { acc: number; heading: number | null };
type Sort = "near" | "big" | "old";

const DAR: Pt = { lat: -6.7924, lng: 39.2083 };
const RADII = [0.5, 1, 2, 3, 4, 5];
const ARRIVE_M = 35;

const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);
const daysSince = (d: string | null, today: string) =>
  d ? Math.max(0, Math.round((new Date(today + "T12:00:00Z").getTime() - new Date(d + "T12:00:00Z").getTime()) / 86_400_000)) : null;

function pin(owes: boolean, label: string, big: boolean) {
  if (big) return `<div style="position:relative;width:28px;height:40px">${teardropHtml(owes ? "#EA4335" : "#188038")}${owes && label ? `<div style="position:absolute;left:30px;top:2px;white-space:nowrap;background:#fff;color:#a50e0e;font:600 12px/1.4 system-ui;padding:1px 6px;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,.35)">${label}</div>` : ""}</div>`;
  const bg = owes ? "#EA4335" : "#188038";
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
  const [headingUp, setHeadingUp] = useState(true);
  const [mapBearing, setMapBearing] = useState(0);
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
      addBaseTiles(lib, m);
      lib.control.zoom({ position: "topright" }).addTo(m);
      routeLayer.current = lib.layerGroup().addTo(m);
      shopLayer.current = lib.layerGroup().addTo(m);
      meLayer.current = lib.layerGroup().addTo(m);
      m.on("dragstart", () => setFollow(false));
      m.on("rotate", () => setMapBearing(m.getBearing()));
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
        const h = pos.coords.heading;
        const moving = (pos.coords.speed ?? 0) > 0.6;
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, heading: h !== null && !Number.isNaN(h) && moving ? h : null };
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
        icon: big
          ? lib.divIcon({ html: pin(c.owes, c.owes ? short(Number(c.balance)) : "", true), className: "", iconSize: [28, 40], iconAnchor: [14, 40] })
          : lib.divIcon({ html: pin(c.owes, c.owes ? short(Number(c.balance)) : "", false), className: "", iconSize: [16, 16] }),
        zIndexOffset: big ? 1000 : c.owes ? 500 : 0,
      })
        .on("click", () => {
          if (!target) setSelected(c.id);
        })
        .addTo(shopLayer.current);
    }
  }, [ready, visible, selected, target]);

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
    setHeadingUp(true);
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
    map.current?.setBearing(0);
  }

  // Release the screen lock when leaving the page
  useEffect(() => () => {
    wakeLock.current?.release().catch(() => {});
  }, []);

  // Progress along the route as I move
  const progress = useMemo(() => {
    if (!target || !me) return null;
    const straight = meters(me, target);
    const toTarget = bearing(me, target);
    type Next = { text: string; in: number; type: string; modifier: string };
    if (!route) return { left: straight, secs: null as number | null, off: 0, idx: 0, next: null as Next | null, then: null as Next | null, straight, dir: me.heading ?? toTarget };
    const s = snap(route, me);
    const left = Math.max(0, route.distance - s.along) + (s.off > 30 ? s.off : 0);
    const speed = route.duration > 0 ? route.distance / route.duration : 1.3;
    const k = route.steps.findIndex((st) => st.idx > s.idx && route.cum[st.idx] > s.along + 5);
    const nextStep = k >= 0 ? route.steps[k] : undefined;
    const thenStep = k >= 0 ? route.steps[k + 1] : undefined;
    // Which way I am going: along the road when I am on it, else my compass, else straight at the shop
    const a = route.coords[s.idx], b = route.coords[Math.min(s.idx + 1, route.coords.length - 1)];
    const dir = s.off < 30 && meters(a, b) > 1 ? bearing(a, b) : me.heading ?? toTarget;
    return {
      left,
      secs: left / speed,
      off: s.off,
      idx: s.idx,
      next: nextStep ? { text: nextStep.text, in: route.cum[nextStep.idx] - s.along, type: nextStep.type, modifier: nextStep.modifier } : null,
      then: thenStep ? { text: thenStep.text, in: route.cum[thenStep.idx] - s.along, type: thenStep.type, modifier: thenStep.modifier } : null,
      straight,
      dir,
    };
  }, [target, me, route]);
  const navDir = progress ? Math.round(progress.dir) : null;

  // Me, radius circle
  useEffect(() => {
    const lib = L.current;
    if (!ready || !lib || !meLayer.current) return;
    meLayer.current.clearLayers();
    if (!me) return;
    if (radius && !target) {
      lib.circle([me.lat, me.lng], { radius: radius * 1000, color: "#16654a", weight: 1.5, dashArray: "6 6", fillOpacity: 0.04, interactive: false }).addTo(meLayer.current);
    }
    if (!target) lib.circle([me.lat, me.lng], { radius: me.acc, color: "#4285F4", weight: 1, opacity: 0.4, fillColor: "#4285F4", fillOpacity: 0.12, interactive: false }).addTo(meLayer.current);
    // Marker icons stay upright when the map turns, so add the map's turn to my heading
    const icon = target
      ? lib.divIcon({ html: navArrowHtml((navDir ?? 0) + mapBearing), className: "", iconSize: [44, 44] })
      : lib.divIcon({ html: meDotHtml(me.heading === null ? null : me.heading + mapBearing), className: "", iconSize: [22, 22] });
    lib.marker([me.lat, me.lng], { icon, interactive: false, zIndexOffset: 2000 }).addTo(meLayer.current);
  }, [ready, me, radius, target, navDir, mapBearing]);


  // Arrive, re-route when off the path, follow me
  useEffect(() => {
    if (!target || !me || !progress) return;
    const m = map.current;
    if (followRef.current && m) {
      if (headingUp) {
        // Like Google Maps: the way I am going points up, and I sit low on the screen so I see what is ahead
        const want = (360 - progress.dir) % 360;
        const diff = Math.abs(((m.getBearing() - want + 540) % 360) - 180);
        if (diff > 6) m.setBearing(want);
        const mpp = (40075016.686 * Math.cos((me.lat * Math.PI) / 180)) / 2 ** (m.getZoom() + 8);
        const c = ahead(me, progress.dir, m.getSize().y * 0.2 * mpp);
        m.panTo([c.lat, c.lng], { animate: true });
      } else {
        m.panTo([me.lat, me.lng], { animate: true });
      }
    }
    if (arrived || routing) return;
    const last = lastRoute.current;
    const since = last ? Date.now() - last.at : Infinity;
    const movedFromLast = last ? meters(last.from, me) : Infinity;
    const offRoute = route ? progress.off > 45 : true;
    if ((offRoute && since > 12_000 && movedFromLast > 25) || (since > 120_000 && movedFromLast > 150)) {
      loadRoute(me, target, mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, route, headingUp]);

  // Draw the route still ahead of me
  useEffect(() => {
    const lib = L.current;
    if (!ready || !lib || !routeLayer.current) return;
    routeLayer.current.clearLayers();
    if (!target) return;
    if (!route) {
      if (me) lib.polyline([[me.lat, me.lng], [target.lat, target.lng]], { color: "#5f6368", weight: 4, dashArray: "2 10", lineCap: "round", opacity: 0.8 }).addTo(routeLayer.current);
      return;
    }
    const idx = progress?.idx ?? 0;
    const rest = route.coords.slice(idx + 1).map((p) => [p.lat, p.lng] as [number, number]);
    const start: [number, number] = me ? [me.lat, me.lng] : [route.coords[idx].lat, route.coords[idx].lng];
    const line = [start, ...rest];
    if (mode === "foot") {
      // Google draws walking routes as a row of blue dots
      lib.polyline(line, { color: "#1967D2", weight: 9, dashArray: "0 14", lineCap: "round", opacity: 1 }).addTo(routeLayer.current);
      lib.polyline(line, { color: "#4285F4", weight: 6, dashArray: "0 14", lineCap: "round", opacity: 1 }).addTo(routeLayer.current);
    } else {
      lib.polyline(line, { color: "#1967D2", weight: 11, lineCap: "round", lineJoin: "round", opacity: 1 }).addTo(routeLayer.current);
      lib.polyline(line, { color: "#4285F4", weight: 7, lineCap: "round", lineJoin: "round", opacity: 1 }).addTo(routeLayer.current);
    }
  }, [ready, route, target, me, progress?.idx, mode]);

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
    <div className={`relative isolate -mx-4 -mt-4 h-[calc(100dvh-8.75rem)] overflow-hidden md:mx-0 md:mt-0 md:h-[calc(100dvh-7rem)] md:rounded-2xl md:border md:border-gray-200 ${target ? "navigating" : ""}`}>
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
      <div className={`absolute right-3 z-[1000] flex flex-col items-end gap-2 ${target ? "bottom-40" : "bottom-4"}`}>
        <CompassButton map={mapObj} onNorth={() => setHeadingUp(false)} />
        {target && (
          <button onClick={overview} className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-lg" aria-label="See whole route" title="See whole route">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4zm0 0v13.5m6-11v13.5" fill="none" stroke="#5f6368" strokeWidth="2" strokeLinejoin="round" /></svg>
          </button>
        )}
        {!target && (
          <button
            onClick={() => { setFollow(true); if (me) map.current?.flyTo([me.lat, me.lng], Math.max(map.current?.getZoom() ?? 15, 15), { duration: 0.6 }); }}
            className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-lg"
            aria-label="Go to my location"
          >
            <LocateIcon active={!!me} />
          </button>
        )}
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

      {/* Navigating, styled like Google Maps */}
      {target && (
        <>
          <div className="absolute inset-x-2 top-2 z-[1000] overflow-hidden rounded-2xl text-white shadow-xl">
            <div className="flex items-center gap-3 bg-[#137333] px-3 py-3">
              {arrived ? (
                <>
                  <TurnIcon type="arrive" modifier="" />
                  <div className="text-xl font-bold">You have arrived</div>
                </>
              ) : progress?.next ? (
                <>
                  <TurnIcon type={progress.next.type} modifier={progress.next.modifier} size={44} />
                  <div className="min-w-0">
                    <div className="text-2xl font-bold leading-tight tabular-nums">{fmtMeters(progress.next.in)}</div>
                    <div className="truncate text-base font-medium leading-snug">{progress.next.text}</div>
                  </div>
                </>
              ) : (
                <>
                  <TurnIcon type="depart" modifier="straight" />
                  <div className="text-base font-medium">{routing ? "Finding the best way…" : `Head to ${target.name}`}</div>
                </>
              )}
            </div>
            {!arrived && progress?.then && progress.next && progress.then.in - progress.next.in < 250 && (
              <div className="inline-flex items-center gap-1.5 rounded-br-2xl bg-[#0d652d] px-3 py-1.5 text-sm font-medium">
                Then <TurnIcon type={progress.then.type} modifier={progress.then.modifier} size={20} />
              </div>
            )}
            {routeError && <div className="bg-[#0d652d] px-3 py-1.5 text-xs text-amber-100">{routeError}</div>}
          </div>

          {!follow && !arrived && (
            <button
              onClick={() => { setFollow(true); setHeadingUp(true); if (me) map.current?.setView([me.lat, me.lng], 17); }}
              className="absolute bottom-40 left-3 z-[1000] flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-[#1A73E8] shadow-lg"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2 20 21 12 16.5 4 21Z" fill="#1A73E8" /></svg>
              Re-centre
            </button>
          )}

          <div className="absolute inset-x-0 bottom-0 z-[1001] rounded-t-3xl bg-white px-4 pb-4 pt-2 shadow-[0_-4px_20px_rgba(0,0,0,.15)]">
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-gray-300" />
            {arrived ? (
              <>
                <div className="truncate text-center font-semibold">{withRef(target.name, target.contact_name)}</div>
                {Number(target.balance) > 0 && <div className="text-center text-sm font-semibold text-red-700">Owes {tzs(target.balance)}</div>}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-medium">
                  <Link href={`/customers/${target.id}`} className="rounded-xl bg-brand-600 p-2 text-white">💵<br />Payment</Link>
                  <Link href={`/sales/new?customer=${target.id}`} className="rounded-xl bg-brand-50 p-2 text-brand-700">🛒<br />Sell</Link>
                  <button onClick={stop} className="rounded-xl bg-gray-100 p-2 text-gray-700">✓<br />Done</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <button onClick={stop} className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-gray-300 text-[#d93025]" aria-label="End navigation">
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
                  </button>
                  <div className="min-w-0 flex-1 text-center">
                    <div className="text-2xl font-bold leading-tight text-[#188038] tabular-nums">
                      {progress?.secs != null ? fmtMinutes(progress.secs) : routing ? "…" : fmtMeters(progress?.left ?? 0)}
                    </div>
                    <div className="text-sm text-gray-600 tabular-nums">
                      {progress ? fmtMeters(progress.left) : "…"}
                      {progress?.secs != null && <> · {arrivalTime(progress.secs)}</>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col overflow-hidden rounded-full border border-gray-300 text-lg">
                    <button onClick={() => changeMode("foot")} className={`px-3 py-0.5 ${mode === "foot" ? "bg-[#e8f0fe]" : ""}`} aria-label="Walk">🚶</button>
                    <button onClick={() => changeMode("car")} className={`px-3 py-0.5 ${mode === "car" ? "bg-[#e8f0fe]" : ""}`} aria-label="Ride">🛵</button>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2 text-sm">
                  <span className="min-w-0 truncate text-gray-700">To <b>{withRef(target.name, target.contact_name)}</b></span>
                  {Number(target.balance) > 0 && <span className="shrink-0 font-semibold text-red-700">owes {tzs(target.balance)}</span>}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

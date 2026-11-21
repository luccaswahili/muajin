"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import { MAP_STYLE, flattenBuildings, meDotHtml, navArrowHtml, teardropHtml } from "@/lib/map-style";
import { CompassButton } from "@/components/compass-button";
import { TurnIcon } from "@/components/turn-icon";
import { LocateIcon } from "@/components/locate-icon";
import { fmtDate, tzs } from "@/lib/format";
import { withRef } from "@/lib/shops";
import { ahead, arrivalTime, bearing, circleRing, fetchRoute, fmtMeters, fmtMinutes, meters, snap, waNumber, type Mode, type Pt, type Route } from "@/lib/nav";

export type LocateCustomer = {
  id: string; name: string; contact_name: string | null; phone: string | null; area: string | null;
  lat: number; lng: number; balance: number; last_purchase: string | null;
  /** Date of the oldest sale not fully paid */
  owing_since: string | null;
  last_payment: string | null;
};

type Me = Pt & { acc: number; heading: number | null };
type Sort = "near" | "big" | "old";
type Feature = GeoJSON.Feature;

const DAR: Pt = { lat: -6.7924, lng: 39.2083 };
const RADII = [0.5, 1, 2, 3, 4, 5];
const ARRIVE_M = 35;
/** How long the arrow glides from one GPS fix to the next */
const GLIDE_MS = 950;

const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);
const daysSince = (d: string | null, today: string) =>
  d ? Math.max(0, Math.round((new Date(today + "T12:00:00Z").getTime() - new Date(d + "T12:00:00Z").getTime()) / 86_400_000)) : null;
const fc = (features: Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });
const ringFeature = (c: Pt, r: number): Feature => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(c, r)] } });

function bigPin(owes: boolean, label: string) {
  const tag = owes && label
    ? `<div style="position:absolute;left:30px;top:2px;white-space:nowrap;background:#fff;color:#a50e0e;font:600 12px/1.4 system-ui;padding:1px 6px;border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,.35)">${label}</div>`
    : "";
  return `<div style="position:relative;width:28px;height:40px">${teardropHtml(owes ? "#EA4335" : "#188038")}${tag}</div>`;
}

export function LocateMap({ customers, isAgent, today, unlocatedDebtors }: {
  customers: LocateCustomer[]; isAgent: boolean; today: string; unlocatedDebtors: { count: number; total: number };
}) {
  const el = useRef<HTMLDivElement>(null);
  const ml = useRef<typeof import("maplibre-gl") | null>(null);
  const map = useRef<MlMap | null>(null);
  const meMarker = useRef<Marker | null>(null);
  const meKind = useRef<"dot" | "arrow" | null>(null);
  const pinMarker = useRef<Marker | null>(null);
  const shown = useRef<Pt | null>(null);
  const glide = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);

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
  const lastRoute = useRef<{ at: number; from: Pt } | null>(null);
  const routeAbort = useRef<AbortController | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const targetRef = useRef<LocateCustomer | null>(null);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const owedTo = isAgent ? "Owe you" : "Owe Muwa Gin";

  // Map: vector tiles drawn by the phone's graphics chip, so turning and zooming stay smooth
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await import("maplibre-gl");
      if (cancelled || !el.current || map.current) return;
      ml.current = lib;
      const m = new lib.Map({
        container: el.current,
        style: MAP_STYLE,
        center: [DAR.lng, DAR.lat],
        zoom: 12,
        maxPitch: 60,
        attributionControl: { compact: true },
      });
      map.current = m;
      m.on("load", () => {
        if (cancelled) return;
        flattenBuildings(m);
        m.addSource("radius", { type: "geojson", data: fc([]) });
        m.addSource("acc", { type: "geojson", data: fc([]) });
        m.addSource("route", { type: "geojson", data: fc([]) });
        m.addSource("customers", { type: "geojson", data: fc([]) });
        m.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": "#188038", "fill-opacity": 0.05 } });
        m.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": "#188038", "line-width": 1.5, "line-dasharray": [3, 3] } });
        m.addLayer({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#4285F4", "fill-opacity": 0.12 } });
        // Route: blue line with a darker edge when riding, a row of blue dots when walking
        const solid: ["==", ["get", string], string] = ["==", ["get", "kind"], "solid"];
        const straight: ["==", ["get", string], string] = ["==", ["get", "kind"], "straight"];
        m.addLayer({ id: "route-straight", type: "line", source: "route", filter: straight, layout: { "line-cap": "round" }, paint: { "line-color": "#5f6368", "line-width": 4, "line-dasharray": [0, 2.5] } });
        m.addLayer({ id: "route-casing", type: "line", source: "route", filter: solid, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1967D2", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6, 18, 14] } });
        m.addLayer({ id: "route-line", type: "line", source: "route", filter: solid, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#4285F4", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 4, 18, 10] } });
        m.addLayer({ id: "route-dots", type: "circle", source: "route", filter: ["==", ["get", "kind"], "dot"], paint: { "circle-color": "#4285F4", "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.5, 18, 5.5], "circle-stroke-color": "#1967D2", "circle-stroke-width": 1 } });
        m.addLayer({
          id: "cust-dot", type: "circle", source: "customers",
          paint: {
            "circle-color": ["case", ["get", "owes"], "#EA4335", "#188038"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 8],
            "circle-stroke-color": "#fff", "circle-stroke-width": 2.5,
          },
        });
        m.addLayer({
          id: "cust-label", type: "symbol", source: "customers", filter: ["get", "owes"],
          layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-anchor": "left", "text-offset": [0.9, 0], "text-allow-overlap": false },
          paint: { "text-color": "#a50e0e", "text-halo-color": "#fff", "text-halo-width": 2 },
        });
        setReady(true);
      });
      m.on("dragstart", () => setFollow(false));
      m.on("rotate", () => setMapBearing(m.getBearing()));
      m.on("rotatestart", (e) => {
        if ((e as { originalEvent?: Event }).originalEvent) setHeadingUp(false);
      });
      m.on("click", (e) => {
        if (targetRef.current) return;
        const box: [[number, number], [number, number]] = [[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]];
        const hit = m.getLayer("cust-dot") ? m.queryRenderedFeatures(box, { layers: ["cust-dot"] })[0] : undefined;
        setSelected(hit ? String(hit.properties?.id) : null);
      });
    })();
    return () => {
      cancelled = true;
      if (glide.current) cancelAnimationFrame(glide.current);
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
          map.current?.jumpTo({ center: [p.lng, p.lat], zoom: 15 });
        }
      },
      (err) =>
        setGeoError(err.code === 1 ? "Location is blocked. Allow location for this site in your browser settings." : "Looking for your location… go outside if it takes long."),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
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

  // Customer dots (the picked one gets a big pin instead). Positions only change when the list does.
  const pinned = target?.id ?? selected;
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const show = target ? [] : visible.filter((c) => c.id !== pinned);
    (m.getSource("customers") as GeoJSONSource).setData(fc(show.map((c) => ({
      type: "Feature",
      properties: { id: c.id, owes: c.owes, label: c.owes ? short(Number(c.balance)) : "" },
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
    }))));
  }, [ready, visible, pinned, target]);

  useEffect(() => {
    const lib = ml.current;
    const m = map.current;
    if (!ready || !lib || !m) return;
    pinMarker.current?.remove();
    pinMarker.current = null;
    const c = withDist.find((x) => x.id === pinned);
    if (!c) return;
    const div = document.createElement("div");
    div.innerHTML = bigPin(c.owes, c.owes ? short(Number(c.balance)) : "");
    pinMarker.current = new lib.Marker({ element: div, anchor: "bottom-left", offset: [-14, 0] }).setLngLat([c.lng, c.lat]).addTo(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinned]);

  // Radius ring and how sure the phone is of my spot
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("radius") as GeoJSONSource).setData(fc(me && radius && !target ? [ringFeature(me, radius * 1000)] : []));
    (m.getSource("acc") as GeoJSONSource).setData(fc(me && !target && me.acc > 5 ? [ringFeature(me, me.acc)] : []));
  }, [ready, me, radius, target]);

  // Fit the radius on screen when it changes
  useEffect(() => {
    const lib = ml.current;
    const m = map.current;
    if (!ready || !lib || !m || !me || !radius || target) return;
    const n = ahead(me, 0, radius * 1000), e = ahead(me, 90, radius * 1000), s = ahead(me, 180, radius * 1000), w = ahead(me, 270, radius * 1000);
    m.fitBounds([[w.lng, s.lat], [e.lng, n.lat]], { padding: 24, bearing: m.getBearing() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, radius]);

  const sel = withDist.find((c) => c.id === selected) ?? null;

  function focus(c: LocateCustomer) {
    setSelected(c.id);
    setShowList(false);
    setSearchOpen(false);
    setQuery("");
    map.current?.flyTo({ center: [c.lng, c.lat], zoom: 17, duration: 700 });
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
      map.current?.easeTo({ center: [me.lng, me.lat], zoom: 17, pitch: 45, duration: 800 });
      loadRoute(me, c, mode);
    }
  }

  function stop() {
    routeAbort.current?.abort();
    setTarget(null);
    setSelected(target?.id ?? null);
    setRoute(null);
    setRouteError("");
    setArrived(false);
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    map.current?.easeTo({ bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
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
    if (!route) return { left: straight, secs: null as number | null, off: 0, idx: 0, pt: me as Pt, onRoad: false, next: null as Next | null, then: null as Next | null, straight, dir: me.heading ?? toTarget };
    const s = snap(route, me);
    const left = Math.max(0, route.distance - s.along) + (s.off > 30 ? s.off : 0);
    const speed = route.duration > 0 ? route.distance / route.duration : 1.3;
    const k = route.steps.findIndex((st) => st.idx > s.idx && route.cum[st.idx] > s.along + 5);
    const nextStep = k >= 0 ? route.steps[k] : undefined;
    const thenStep = k >= 0 ? route.steps[k + 1] : undefined;
    // Which way I am going: along the road when I am on it, else my compass, else straight at the shop
    const onRoad = s.off < 30;
    const a = route.coords[s.idx], b = route.coords[Math.min(s.idx + 1, route.coords.length - 1)];
    const dir = onRoad && meters(a, b) > 1 ? bearing(a, b) : me.heading ?? toTarget;
    return {
      left,
      secs: left / speed,
      off: s.off,
      idx: s.idx,
      // Like Google: when I am close to the road, show me on the road so GPS wobble does not jump around
      pt: onRoad ? s.pt : (me as Pt),
      onRoad,
      next: nextStep ? { text: nextStep.text, in: route.cum[nextStep.idx] - s.along, type: nextStep.type, modifier: nextStep.modifier } : null,
      then: thenStep ? { text: thenStep.text, in: route.cum[thenStep.idx] - s.along, type: thenStep.type, modifier: thenStep.modifier } : null,
      straight,
      dir,
    };
  }, [target, me, route]);

  // My marker: blue dot normally, blue arrow while navigating. It glides between GPS fixes.
  useEffect(() => {
    const lib = ml.current;
    const m = map.current;
    if (!ready || !lib || !m || !me) return;
    const kind = target ? "arrow" : "dot";
    const to = progress?.pt ?? me;
    if (!meMarker.current || meKind.current !== kind) {
      meMarker.current?.remove();
      const div = document.createElement("div");
      div.innerHTML = kind === "arrow" ? navArrowHtml() : meDotHtml(true);
      meMarker.current = new lib.Marker({ element: div, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat([to.lng, to.lat]).addTo(m);
      meKind.current = kind;
      shown.current = to;
    }
    const mk = meMarker.current;
    const facing = target ? progress?.dir ?? 0 : me.heading;
    mk.setRotation(facing ?? 0);
    const beam = mk.getElement().querySelector<HTMLElement>("[data-beam]");
    if (beam) beam.style.display = facing === null ? "none" : "";

    // Glide from where the arrow is drawn now to the new spot
    const from = shown.current ?? to;
    const jump = meters(from, to);
    if (glide.current) cancelAnimationFrame(glide.current);
    const t0 = performance.now();
    const ms = jump > 250 ? 0 : GLIDE_MS;
    const frame = (now: number) => {
      const k = ms ? Math.min(1, (now - t0) / ms) : 1;
      const p = { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
      shown.current = p;
      mk.setLngLat([p.lng, p.lat]);
      if (k < 1) glide.current = requestAnimationFrame(frame);
    };
    glide.current = requestAnimationFrame(frame);

    // Camera follows in the same glide, so the map and the arrow move together
    if (target && follow) {
      const h = m.getContainer().clientHeight;
      m.easeTo({
        center: [to.lng, to.lat],
        bearing: headingUp ? progress?.dir ?? m.getBearing() : m.getBearing(),
        pitch: headingUp ? 45 : m.getPitch(),
        padding: { top: Math.round(h * 0.45), bottom: 150, left: 0, right: 0 },
        duration: ms || 300,
        easing: (t) => t,
      });
    }
  }, [ready, me, target, progress, follow, headingUp]);

  // Draw the route still ahead of me. Only the data changes; the map redraws it on the GPU.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const src = m.getSource("route") as GeoJSONSource;
    if (!target) {
      src.setData(fc([]));
      return;
    }
    const start = progress?.pt ?? me;
    if (!route) {
      src.setData(fc(start ? [{ type: "Feature", properties: { kind: "straight" }, geometry: { type: "LineString", coordinates: [[start.lng, start.lat], [target.lng, target.lat]] } }] : []));
      return;
    }
    const idx = progress?.idx ?? 0;
    const coords: [number, number][] = [
      ...(start ? [[start.lng, start.lat] as [number, number]] : []),
      ...route.coords.slice(idx + 1).map((p) => [p.lng, p.lat] as [number, number]),
    ];
    if (mode === "car") {
      src.setData(fc([{ type: "Feature", properties: { kind: "solid" }, geometry: { type: "LineString", coordinates: coords } }]));
      return;
    }
    // Walking: evenly spaced dots, like Google
    const dots: Feature[] = [];
    const gap = 9;
    let carry = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const a = { lng: coords[i][0], lat: coords[i][1] }, b = { lng: coords[i + 1][0], lat: coords[i + 1][1] };
      const len = meters(a, b);
      for (let d = carry; d < len; d += gap) {
        const t = d / len;
        dots.push({ type: "Feature", properties: { kind: "dot" }, geometry: { type: "Point", coordinates: [a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t] } });
      }
      carry = (carry - len) % gap;
      if (carry < 0) carry += gap;
    }
    src.setData(fc(dots));
  }, [ready, route, target, me, progress, mode]);

  // Get a new route when I leave it, or now and then on a long trip
  useEffect(() => {
    if (!target || !me || !progress || arrived || routing) return;
    const last = lastRoute.current;
    const since = last ? Date.now() - last.at : Infinity;
    const movedFromLast = last ? meters(last.from, me) : Infinity;
    const offRoute = route ? progress.off > 45 : true;
    if ((offRoute && since > 12_000 && movedFromLast > 25) || (since > 120_000 && movedFromLast > 150)) {
      loadRoute(me, target, mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  function changeMode(m: Mode) {
    setMode(m);
    if (target && me) loadRoute(me, target, m);
  }

  function overview() {
    const m = map.current;
    if (!m || !target) return;
    setFollow(false);
    const pts: Pt[] = route ? [...route.coords] : [target];
    if (me) pts.push(me);
    const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
    m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
      padding: { top: 140, bottom: 190, left: 40, right: 70 }, bearing: 0, pitch: 0, duration: 700,
    });
  }

  function recentre() {
    setFollow(true);
    setHeadingUp(true);
    if (me) map.current?.easeTo({ center: [me.lng, me.lat], zoom: 17, pitch: 45, duration: 500 });
  }

  function north() {
    setHeadingUp(false);
    map.current?.easeTo({ bearing: 0, pitch: 0, duration: 400 });
  }

  function reminderText(c: LocateCustomer) {
    return `Habari ${c.name}, hii ni Muwa Gin. Salio lako ni ${tzs(c.balance)}. Tafadhali lipa mapema. Asante!`;
  }

  // ---------------------------------------------------------------- view
  return (
    <div className={`relative isolate -mx-4 -mt-4 h-[calc(100dvh-8.75rem)] overflow-hidden md:mx-0 md:mt-0 md:h-[calc(100dvh-7rem)] md:rounded-2xl md:border md:border-gray-200 ${target ? "navigating" : ""}`}>
      {/* MapLibre makes its own box position:relative, so it sits inside a full-size holder */}
      <div className="absolute inset-0 z-0"><div ref={el} className="h-full w-full bg-gray-100" /></div>

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
        <CompassButton bearing={mapBearing} onClick={north} />
        {target && (
          <button onClick={overview} className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-lg" aria-label="See whole route" title="See whole route">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4zm0 0v13.5m6-11v13.5" fill="none" stroke="#5f6368" strokeWidth="2" strokeLinejoin="round" /></svg>
          </button>
        )}
        {!target && (
          <button
            onClick={() => { setFollow(true); if (me) map.current?.flyTo({ center: [me.lng, me.lat], zoom: Math.max(map.current?.getZoom() ?? 15, 15), duration: 600 }); }}
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
              onClick={recentre}
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

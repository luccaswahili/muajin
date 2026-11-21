"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import { MAP_STYLE, flattenBuildings, meDotHtml, teardropHtml } from "@/lib/map-style";
import { circleRing } from "@/lib/nav";
import { LocateIcon } from "@/components/locate-icon";
import { CompassButton } from "@/components/compass-button";
import { ActionForm, SubmitButton } from "@/components/forms";
import { pinCustomer, saveCustomer, searchCustomers } from "@/app/actions";
import { REGIONS, SHOP_STATUS, SHOP_TYPES, directionsUrl, distanceKm, fmtDistance, withRef } from "@/lib/shops";
import { tzs } from "@/lib/format";

export type Shop = {
  id: string; name: string; phone: string; contact_name: string; shop_type: string; status: string;
  region: string; area: string; lat: number; lng: number; balance: number; cartons_bought: number; last_purchase: string | null;
};
export type CustomerPick = { id: string; name: string; phone: string; area: string; onMap: boolean };
type Point = { lat: number; lng: number };

const DAR: Point = { lat: -6.7924, lng: 39.2083 };

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });

export function ShopMap({ shops, notOnMap, notOnMapCount, canAdd, focusId }: {
  shops: Shop[]; notOnMap: CustomerPick[]; notOnMapCount: number; canAdd: boolean; focusId?: string;
}) {
  const router = useRouter();
  const el = useRef<HTMLDivElement>(null);
  const ml = useRef<typeof import("maplibre-gl") | null>(null);
  const map = useRef<MlMap | null>(null);
  const meMarker = useRef<Marker | null>(null);
  const pinMarker = useRef<Marker | null>(null);

  const [ready, setReady] = useState(false);
  const [mapBearing, setMapBearing] = useState(0);
  const [me, setMe] = useState<(Point & { acc: number }) | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [adding, setAdding] = useState(false);
  const [pin, setPin] = useState<Point | null>(null);
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  const [showList, setShowList] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<CustomerPick | null>(null);
  const addingRef = useRef(false);
  useEffect(() => {
    addingRef.current = adding;
  }, [adding]);

  // Create the map once. Vector map drawn by the phone's graphics chip: smooth zoom and turning.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await import("maplibre-gl");
      if (cancelled || !el.current || map.current) return;
      ml.current = lib;
      const start = shops.find((s) => s.id === focusId);
      const m = new lib.Map({
        container: el.current,
        style: MAP_STYLE,
        center: start ? [start.lng, start.lat] : [DAR.lng, DAR.lat],
        zoom: start ? 17 : 12,
        maxPitch: 60,
        attributionControl: { compact: true },
      });
      map.current = m;
      m.on("load", () => {
        if (cancelled) return;
        flattenBuildings(m);
        m.addSource("acc", { type: "geojson", data: fc([]) });
        m.addSource("shops", { type: "geojson", data: fc([]) });
        m.addLayer({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#4285F4", "fill-opacity": 0.12 } });
        m.addLayer({
          id: "shop-dot", type: "circle", source: "shops",
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, ["case", ["get", "big"], 9, 5.5], 16, ["case", ["get", "big"], 12, 8.5]],
            "circle-stroke-color": ["case", ["get", "big"], "#111", "#fff"],
            "circle-stroke-width": ["case", ["get", "big"], 3.5, 2.5],
          },
        });
        setReady(true);
      });
      m.on("rotate", () => setMapBearing(m.getBearing()));
      m.on("click", (e) => {
        if (addingRef.current) {
          setPin({ lat: e.lngLat.lat, lng: e.lngLat.lng });
          return;
        }
        const box: [[number, number], [number, number]] = [[e.point.x - 14, e.point.y - 14], [e.point.x + 14, e.point.y + 14]];
        const hit = m.getLayer("shop-dot") ? m.queryRenderedFeatures(box, { layers: ["shop-dot"] })[0] : undefined;
        setSelected(hit ? String(hit.properties?.id) : null);
      });
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => shops.filter((s) => !hidden.has(s.status)), [shops, hidden]);

  // Shop dots
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const sorted = [...visible].sort((x, y) => Number(x.id === selected) - Number(y.id === selected));
    (m.getSource("shops") as GeoJSONSource).setData(fc(sorted.map((s) => ({
      type: "Feature",
      properties: { id: s.id, color: SHOP_STATUS[s.status]?.color ?? "#16654a", big: s.id === selected },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    }))));
  }, [ready, visible, selected]);

  // My position
  useEffect(() => {
    const lib = ml.current;
    const m = map.current;
    if (!ready || !lib || !m) return;
    (m.getSource("acc") as GeoJSONSource).setData(fc(me && me.acc > 5 ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circleRing(me, me.acc)] } }] : []));
    if (!me) return;
    if (!meMarker.current) {
      const div = document.createElement("div");
      div.innerHTML = meDotHtml(false);
      meMarker.current = new lib.Marker({ element: div }).setLngLat([me.lng, me.lat]).addTo(m);
    } else {
      meMarker.current.setLngLat([me.lng, me.lat]);
    }
  }, [ready, me]);

  // Pin for a new shop (drag it to the exact door)
  useEffect(() => {
    const lib = ml.current;
    const m = map.current;
    if (!ready || !lib || !m) return;
    if (!adding || !pin) {
      pinMarker.current?.remove();
      pinMarker.current = null;
      return;
    }
    if (!pinMarker.current) {
      const div = document.createElement("div");
      div.innerHTML = teardropHtml("#EA4335");
      const mk = new lib.Marker({ element: div, anchor: "bottom", draggable: true }).setLngLat([pin.lng, pin.lat]).addTo(m);
      mk.on("dragend", () => {
        const q = mk.getLngLat();
        setPin({ lat: q.lat, lng: q.lng });
      });
      pinMarker.current = mk;
    } else {
      pinMarker.current.setLngLat([pin.lng, pin.lat]);
    }
  }, [ready, adding, pin]);

  const locate = useCallback(
    (then?: (p: Point) => void) => {
      if (!navigator.geolocation) {
        setGeoError("This phone/browser cannot share location.");
        return;
      }
      setLocating(true);
      setGeoError("");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
          setMe(p);
          setLocating(false);
          map.current?.flyTo({ center: [p.lng, p.lat], zoom: 17, duration: 800 });
          then?.(p);
        },
        (err) => {
          setLocating(false);
          setGeoError(err.code === 1 ? "Location is blocked. Allow location for this site in your browser settings." : "Could not get your location. Try again outside.");
          then?.(map.current ? { lat: map.current.getCenter().lat, lng: map.current.getCenter().lng } : DAR);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
      );
    },
    [],
  );

  function startAdd() {
    setSelected(null);
    setShowList(false);
    setMode("new");
    setSearch("");
    setPicked(null);
    setAdding(true);
    locate((p) => {
      setPin({ lat: p.lat, lng: p.lng });
      // Keep the pin visible above the form sheet
      const m = map.current;
      m?.once("moveend", () => m.panBy([0, m.getContainer().clientHeight * 0.3]));
    });
  }

  const origin: Point | null = me;
  const nearest = useMemo(() => {
    const o = me ?? DAR;
    return visible
      .map((s) => ({ ...s, km: distanceKm(o, s) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 15);
  }, [visible, me]);
  const sel = shops.find((s) => s.id === selected);
  const [hits, setHits] = useState<CustomerPick[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const text = search.trim();
    if (!text) return;
    let stale = false;
    const t = setTimeout(async () => {
      setSearching(true);
      const found = await searchCustomers(text);
      if (!stale) {
        setHits(found);
        setSearching(false);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [search]);
  const matches = search.trim() ? hits : notOnMap;

  function focus(s: Shop) {
    setSelected(s.id);
    setShowList(false);
    map.current?.flyTo({ center: [s.lng, s.lat], zoom: 17, duration: 800 });
  }

  return (
    <div className="relative isolate -mx-4 -mt-4 h-[calc(100dvh-8.75rem)] overflow-hidden md:mx-0 md:mt-0 md:h-[calc(100dvh-7rem)] md:rounded-2xl md:border md:border-gray-200">
      {/* MapLibre makes its own box position:relative, so it sits inside a full-size holder */}
      <div className="absolute inset-0 z-0"><div ref={el} className="h-full w-full bg-gray-100" /></div>

      {/* Top bar */}
      <div className="absolute inset-x-2 top-2 z-[1000] flex flex-wrap gap-1.5">
        {Object.entries(SHOP_STATUS).map(([k, v]) => (
          <button
            key={k}
            onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
            className={`flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium shadow ${hidden.has(k) ? "opacity-40" : ""}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color }} />
            {v.label} ({shops.filter((s) => s.status === k).length})
          </button>
        ))}
      </div>

      {/* Right buttons */}
      <div className="absolute bottom-4 right-3 z-[1000] flex flex-col items-end gap-2">
        <CompassButton bearing={mapBearing} onClick={() => map.current?.easeTo({ bearing: 0, pitch: 0, duration: 400 })} />
        <Link href="/map/locate" className="flex h-12 flex-col items-center justify-center rounded-full bg-red-600 px-3 text-white shadow-lg" aria-label="Locate customers and follow up on money owed">
          <span className="text-lg leading-none">🎯</span>
          <span className="text-[10px] font-semibold leading-tight">Locate</span>
        </Link>
        <button onClick={() => locate()} className="grid h-12 w-12 place-items-center rounded-full bg-white text-xl shadow-lg" aria-label="Go to my location">
          {locating ? "…" : <LocateIcon active={!!me} />}
        </button>
      </div>

      {/* Bottom actions */}
      {!adding && !sel && (
        <div className="absolute bottom-4 left-3 right-20 z-[1000] flex gap-2">
          {canAdd && <button onClick={startAdd} className="btn-primary flex-1 shadow-lg">+ Add customer here</button>}
          <button onClick={() => setShowList((v) => !v)} className="btn-secondary shadow-lg">Nearby</button>
        </div>
      )}

      {geoError && (
        <div className="absolute inset-x-3 top-12 z-[1000] rounded-xl bg-amber-50 p-2 text-xs text-amber-900 shadow">{geoError}</div>
      )}

      {/* Nearby list */}
      {showList && !adding && (
        <div className="absolute inset-x-0 bottom-0 z-[1001] max-h-[60%] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Closest customers {me ? "to you" : "to Dar centre"}</h3>
            <button onClick={() => setShowList(false)} className="text-sm text-gray-500">Close</button>
          </div>
          {nearest.length === 0 && <p className="py-4 text-center text-sm text-gray-500">No customers on the map yet.</p>}
          <div className="divide-y divide-gray-100">
            {nearest.map((s) => (
              <button key={s.id} onClick={() => focus(s)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SHOP_STATUS[s.status]?.color }} />
                    <span className="truncate">{withRef(s.name, s.contact_name)}</span>
                  </span>
                  <span className="block text-xs text-gray-500">{[SHOP_TYPES[s.shop_type], s.area].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-brand-700">{fmtDistance(s.km)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected shop */}
      {sel && !adding && (
        <div className="absolute inset-x-0 bottom-0 z-[1001] rounded-t-2xl bg-white p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold">{withRef(sel.name, sel.contact_name)}</div>
              <div className="text-xs text-gray-500">
                {SHOP_TYPES[sel.shop_type]} · <span style={{ color: SHOP_STATUS[sel.status]?.color }}>{SHOP_STATUS[sel.status]?.label}</span>
                {origin && ` · ${fmtDistance(distanceKm(origin, sel))} away`}
              </div>
              <div className="text-xs text-gray-500">{[sel.phone, sel.area, sel.region].filter(Boolean).join(" · ")}</div>
              <div className="mt-1 text-xs">
                Bought {sel.cartons_bought} ctn{sel.last_purchase ? ` · last ${sel.last_purchase}` : ""}
                {Number(sel.balance) > 0 && <span className="ml-1 font-semibold text-amber-700">owes {tzs(sel.balance)}</span>}
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-xl text-gray-400">×</button>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs font-medium">
            <a href={directionsUrl(sel.lat, sel.lng)} target="_blank" rel="noreferrer" className="rounded-xl bg-brand-50 p-2 text-brand-700">🧭<br />Directions</a>
            {sel.phone ? <a href={`tel:${sel.phone}`} className="rounded-xl bg-brand-50 p-2 text-brand-700">📞<br />Call</a> : <span className="rounded-xl bg-gray-50 p-2 text-gray-400">📞<br />No phone</span>}
            <Link href={`/sales/new?customer=${sel.id}`} className="rounded-xl bg-brand-600 p-2 text-white">🛒<br />Sell</Link>
            <Link href={`/customers/${sel.id}`} className="rounded-xl bg-brand-50 p-2 text-brand-700">ℹ️<br />Details</Link>
          </div>
        </div>
      )}

      {/* Add customer here */}
      {adding && (
        <div className="absolute inset-x-0 bottom-0 z-[1001] max-h-[70%] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Add customer here</h3>
            <button onClick={() => { setAdding(false); setPin(null); }} className="text-sm text-gray-500">Cancel</button>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {locating ? "Finding your location…" : pin ? `📍 Pin is at your location${me ? ` (accurate to about ${Math.round(me.acc)} m)` : ""}. Drag the pin or tap the map to adjust.` : "Tap the map to place the pin."}
          </p>
          <div className="mb-3 grid gap-2">
            <button
              onClick={() => setMode("new")}
              className={`rounded-xl border-2 px-3 py-2.5 text-left text-sm font-semibold ${mode === "new" ? "border-brand-600 bg-brand-50 text-brand-800" : "border-gray-200 text-gray-700"}`}
            >
              + Add new customer here
            </button>
            <button
              onClick={() => setMode("existing")}
              className={`rounded-xl border-2 px-3 py-2 text-left text-sm ${mode === "existing" ? "border-brand-600 bg-brand-50 font-semibold text-brand-800" : "border-gray-200 text-gray-600"}`}
            >
              Customer already registered? Add from list
              {notOnMapCount > 0 && <span className="block text-xs font-normal text-gray-500">{notOnMapCount} customers are not on the map yet</span>}
            </button>
          </div>

          {mode === "new" ? (
            <ActionForm
              key="new"
              action={saveCustomer}
              onSuccess={() => { setAdding(false); setPin(null); router.refresh(); }}
            >
              <input type="hidden" name="lat" value={pin?.lat ?? ""} />
              <input type="hidden" name="lng" value={pin?.lng ?? ""} />
              <input name="name" className="input" placeholder="Shop / customer name" required />
              <div className="grid grid-cols-2 gap-2">
                <input name="contact_name" className="input" placeholder="Reference (a hint to remember them)" />
                <input name="phone" className="input" placeholder="Phone" inputMode="tel" />
                <select name="shop_type" className="input" defaultValue="magi_shop">
                  {Object.entries(SHOP_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select name="status" className="input" defaultValue="prospect">
                  {Object.entries(SHOP_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <input name="area" className="input" placeholder="Area / street (e.g. Sinza)" />
                <select name="region" className="input" defaultValue="Dar es Salaam">
                  {REGIONS.map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              <input name="notes" className="input" placeholder="Notes (e.g. sells Konyagi, wants credit)" />
              <SubmitButton>Save customer</SubmitButton>
            </ActionForm>
          ) : picked ? (
            <ActionForm
              key={`pin-${picked.id}`}
              action={pinCustomer}
              onSuccess={() => { setAdding(false); setPin(null); setPicked(null); router.refresh(); }}
            >
              <input type="hidden" name="id" value={picked.id} />
              <input type="hidden" name="lat" value={pin?.lat ?? ""} />
              <input type="hidden" name="lng" value={pin?.lng ?? ""} />
              <div className="rounded-xl bg-gray-50 p-3 text-sm">
                <div className="font-semibold">{picked.name}</div>
                <div className="text-xs text-gray-500">{[picked.phone, picked.area].filter(Boolean).join(" · ")}</div>
                {picked.onMap && <div className="mt-1 text-xs text-amber-700">Already on the map. Saving moves their pin here.</div>}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPicked(null)} className="btn-secondary">Back</button>
                <div className="flex-1"><SubmitButton>Pin {picked.name} here</SubmitButton></div>
              </div>
            </ActionForm>
          ) : (
            <div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input"
                placeholder="Search name or phone number"
                autoFocus
              />
              <div className="mt-2 divide-y divide-gray-100">
                {matches.map((c) => (
                  <button key={c.id} onClick={() => setPicked(c)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block text-xs text-gray-500">{[c.phone, c.area].filter(Boolean).join(" · ") || "No phone"}</span>
                    </span>
                    <span className={`shrink-0 text-xs ${c.onMap ? "text-gray-400" : "font-semibold text-amber-700"}`}>{c.onMap ? "on map" : "not on map"}</span>
                  </button>
                ))}
                {!search.trim() && matches.length > 0 && <p className="pt-2 text-xs text-gray-400">Newest customers not on the map. Search to find anyone else.</p>}
                {searching && <p className="py-2 text-center text-sm text-gray-400">Searching…</p>}
                {!searching && matches.length === 0 && (
                  <p className="py-4 text-center text-sm text-gray-500">{search.trim() ? "No customer found. Use “Add new customer here”." : "Type a name or phone number."}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

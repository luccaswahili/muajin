"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as Leaflet from "leaflet";
import { ActionForm, SubmitButton } from "@/components/forms";
import { saveCustomer } from "@/app/actions";
import { REGIONS, SHOP_STATUS, SHOP_TYPES, directionsUrl, distanceKm, fmtDistance } from "@/lib/shops";
import { tzs } from "@/lib/format";

export type Shop = {
  id: string; name: string; phone: string; contact_name: string; shop_type: string; status: string;
  region: string; area: string; lat: number; lng: number; balance: number; cartons_bought: number; last_purchase: string | null;
};
type Point = { lat: number; lng: number };

const DAR: Point = { lat: -6.7924, lng: 39.2083 };

function dot(color: string, size = 18, ring = "#fff") {
  return `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid ${ring};box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`;
}

export function ShopMap({ shops, canAdd, focusId }: { shops: Shop[]; canAdd: boolean; focusId?: string }) {
  const router = useRouter();
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const shopLayer = useRef<Leaflet.LayerGroup | null>(null);
  const meLayer = useRef<Leaflet.LayerGroup | null>(null);
  const pinMarker = useRef<Leaflet.Marker | null>(null);

  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<(Point & { acc: number }) | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [adding, setAdding] = useState(false);
  const [pin, setPin] = useState<Point | null>(null);
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  const [showList, setShowList] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const addingRef = useRef(false);
  useEffect(() => {
    addingRef.current = adding;
  }, [adding]);

  // Create the map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = (await import("leaflet")).default;
      if (cancelled || !el.current || map.current) return;
      L.current = lib;
      const start = shops.find((s) => s.id === focusId);
      const m = lib.map(el.current, { zoomControl: false, attributionControl: true }).setView(start ? [start.lat, start.lng] : [DAR.lat, DAR.lng], start ? 17 : 12);
      lib.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      lib.control.zoom({ position: "topright" }).addTo(m);
      shopLayer.current = lib.layerGroup().addTo(m);
      meLayer.current = lib.layerGroup().addTo(m);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => {
        if (addingRef.current) setPin({ lat: e.latlng.lat, lng: e.latlng.lng });
        else setSelected(null);
      });
      map.current = m;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => shops.filter((s) => !hidden.has(s.status)), [shops, hidden]);

  // Shop markers
  useEffect(() => {
    const lib = L.current;
    if (!ready || !lib || !shopLayer.current) return;
    shopLayer.current.clearLayers();
    for (const s of visible) {
      const color = SHOP_STATUS[s.status]?.color ?? "#16654a";
      const big = s.id === selected;
      lib.marker([s.lat, s.lng], {
        icon: lib.divIcon({ html: dot(color, big ? 26 : 18, big ? "#111" : "#fff"), className: "", iconSize: [big ? 26 : 18, big ? 26 : 18] }),
        zIndexOffset: big ? 1000 : 0,
      })
        .on("click", () => setSelected(s.id))
        .addTo(shopLayer.current);
    }
  }, [ready, visible, selected]);

  // My position
  useEffect(() => {
    const lib = L.current;
    if (!ready || !lib || !meLayer.current) return;
    meLayer.current.clearLayers();
    if (!me) return;
    lib.circle([me.lat, me.lng], { radius: me.acc, color: "#2563eb", weight: 1, fillOpacity: 0.1 }).addTo(meLayer.current);
    lib.marker([me.lat, me.lng], {
      icon: lib.divIcon({ html: dot("#2563eb", 18), className: "", iconSize: [18, 18] }),
      interactive: false,
    }).addTo(meLayer.current);
  }, [ready, me]);

  // Pin for a new shop
  useEffect(() => {
    const lib = L.current;
    const m = map.current;
    if (!ready || !lib || !m) return;
    if (!adding || !pin) {
      pinMarker.current?.remove();
      pinMarker.current = null;
      return;
    }
    if (!pinMarker.current) {
      pinMarker.current = lib
        .marker([pin.lat, pin.lng], {
          draggable: true,
          icon: lib.divIcon({
            html: `<div style="transform:translate(-50%,-100%);font-size:34px;line-height:1">📍</div>`,
            className: "",
            iconSize: [0, 0],
          }),
          zIndexOffset: 2000,
        })
        .on("dragend", (e) => {
          const p = (e.target as Leaflet.Marker).getLatLng();
          setPin({ lat: p.lat, lng: p.lng });
        })
        .addTo(m);
    } else {
      pinMarker.current.setLatLng([pin.lat, pin.lng]);
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
          map.current?.flyTo([p.lat, p.lng], 17, { duration: 0.8 });
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
    setAdding(true);
    locate((p) => {
      setPin({ lat: p.lat, lng: p.lng });
      // Keep the pin visible above the form sheet
      const m = map.current;
      m?.once("moveend", () => m.panBy([0, m.getSize().y * 0.3], { animate: true }));
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

  function focus(s: Shop) {
    setSelected(s.id);
    setShowList(false);
    map.current?.flyTo([s.lat, s.lng], 17, { duration: 0.8 });
  }

  return (
    <div className="relative isolate -mx-4 -mt-4 h-[calc(100dvh-8.75rem)] overflow-hidden md:mx-0 md:mt-0 md:h-[calc(100dvh-7rem)] md:rounded-2xl md:border md:border-gray-200">
      <div ref={el} className="absolute inset-0 z-0 bg-gray-100" />

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
        <button onClick={() => locate()} className="grid h-12 w-12 place-items-center rounded-full bg-white text-xl shadow-lg" aria-label="Go to my location">
          {locating ? "…" : "◎"}
        </button>
      </div>

      {/* Bottom actions */}
      {!adding && !sel && (
        <div className="absolute bottom-4 left-3 right-20 z-[1000] flex gap-2">
          {canAdd && <button onClick={startAdd} className="btn-primary flex-1 shadow-lg">+ Register shop here</button>}
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
            <h3 className="font-semibold">Closest shops {me ? "to you" : "to Dar centre"}</h3>
            <button onClick={() => setShowList(false)} className="text-sm text-gray-500">Close</button>
          </div>
          {nearest.length === 0 && <p className="py-4 text-center text-sm text-gray-500">No shops registered yet.</p>}
          <div className="divide-y divide-gray-100">
            {nearest.map((s) => (
              <button key={s.id} onClick={() => focus(s)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SHOP_STATUS[s.status]?.color }} />
                    <span className="truncate">{s.name}</span>
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
              <div className="truncate text-lg font-semibold">{sel.name}</div>
              <div className="text-xs text-gray-500">
                {SHOP_TYPES[sel.shop_type]} · <span style={{ color: SHOP_STATUS[sel.status]?.color }}>{SHOP_STATUS[sel.status]?.label}</span>
                {origin && ` · ${fmtDistance(distanceKm(origin, sel))} away`}
              </div>
              <div className="text-xs text-gray-500">{[sel.contact_name, sel.phone, sel.area, sel.region].filter(Boolean).join(" · ")}</div>
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

      {/* Register shop */}
      {adding && (
        <div className="absolute inset-x-0 bottom-0 z-[1001] max-h-[70%] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Register a shop</h3>
            <button onClick={() => { setAdding(false); setPin(null); }} className="text-sm text-gray-500">Cancel</button>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {locating ? "Finding your location…" : pin ? `📍 ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}${me ? ` (GPS ±${Math.round(me.acc)} m)` : ""}. Drag the pin or tap the map to adjust.` : "Tap the map to place the shop."}
          </p>
          <ActionForm
            action={saveCustomer}
            onSuccess={() => { setAdding(false); setPin(null); router.refresh(); }}
          >
            <input type="hidden" name="lat" value={pin?.lat ?? ""} />
            <input type="hidden" name="lng" value={pin?.lng ?? ""} />
            <input name="name" className="input" placeholder="Shop name" required />
            <div className="grid grid-cols-2 gap-2">
              <input name="contact_name" className="input" placeholder="Owner / contact name" />
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
            <SubmitButton>Save shop</SubmitButton>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

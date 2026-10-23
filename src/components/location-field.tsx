"use client";

import { useState } from "react";

/** Hidden lat/lng inputs with a button to fill them from the phone's GPS. */
export function LocationField({ lat, lng }: { lat: number | null; lng: number | null }) {
  const [pos, setPos] = useState<{ lat: number | null; lng: number | null }>({ lat, lng });
  const [msg, setMsg] = useState("");
  return (
    <div className="rounded-xl bg-gray-50 p-3 text-sm">
      <input type="hidden" name="lat" value={pos.lat ?? ""} />
      <input type="hidden" name="lng" value={pos.lng ?? ""} />
      <div className="mb-2 text-gray-600">
        {pos.lat != null && pos.lng != null ? `📍 ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : "No location saved yet"}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary !py-1.5"
          onClick={() => {
            setMsg("Finding your location…");
            navigator.geolocation?.getCurrentPosition(
              (p) => {
                setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
                setMsg(`Got it (±${Math.round(p.coords.accuracy)} m). Press Save.`);
              },
              () => setMsg("Could not get your location. Allow location for this site."),
              { enableHighAccuracy: true, timeout: 15000 },
            );
          }}
        >
          Use my current location
        </button>
        {pos.lat != null && (
          <button type="button" className="text-xs text-red-600" onClick={() => { setPos({ lat: null, lng: null }); setMsg("Location removed. Press Save."); }}>
            Remove
          </button>
        )}
      </div>
      {msg && <p className="mt-1 text-xs text-gray-500">{msg}</p>}
    </div>
  );
}

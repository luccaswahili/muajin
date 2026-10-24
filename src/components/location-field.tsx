"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pinCustomer } from "@/app/actions";

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

/** One tap: get GPS and save it as this customer's location. */
export function PinHereButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(pinCustomer, null);
  const form = useRef<HTMLFormElement>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (pos) form.current?.requestSubmit();
  }, [pos]);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form ref={form} action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lat" value={pos?.lat ?? ""} />
      <input type="hidden" name="lng" value={pos?.lng ?? ""} />
      <button
        type="button"
        disabled={pending}
        className="btn-primary w-full"
        onClick={() => {
          setMsg("Finding your location…");
          navigator.geolocation?.getCurrentPosition(
            (p) => {
              setMsg("");
              setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
            },
            () => setMsg("Could not get your location. Allow location for this site."),
            { enableHighAccuracy: true, timeout: 15000 },
          );
        }}
      >
        {pending ? "Saving…" : "📍 I'm at this shop now, save location"}
      </button>
      {msg && <p className="mt-1 text-xs text-gray-500">{msg}</p>}
      {state?.error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state?.confirm && pos && (
        <div className="mt-2 flex items-center gap-2">
          <input type="hidden" name="confirm_duplicate" value="true" />
          <button type="submit" disabled={pending} className="btn-secondary w-full">{state.confirm}</button>
        </div>
      )}
    </form>
  );
}

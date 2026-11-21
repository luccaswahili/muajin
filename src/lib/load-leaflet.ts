import type * as Leaflet from "leaflet";

/** Loads Leaflet in the browser with the rotate plugin (two-finger turn, setBearing). */
export async function loadLeaflet(): Promise<typeof Leaflet> {
  const lib = (await import("leaflet")).default;
  // The plugin extends the global L
  (window as unknown as { L: typeof Leaflet }).L = lib;
  // @ts-expect-error the plugin ships no types; it only patches L
  await import("leaflet-rotate");
  return lib;
}

/** Map options that turn rotation on. The compass button is ours, not the plugin's. */
export const ROTATE_OPTIONS = { rotate: true, touchRotate: true, shiftKeyRotate: true, rotateControl: false, bearing: 0 } as const;

/** Map tiles with a calmer, Google-Maps-like look (softer colours, lighter roads). */
export function addBaseTiles(lib: typeof Leaflet, m: Leaflet.Map) {
  return lib
    .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      className: "map-tiles",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    })
    .addTo(m);
}

/** Google-style blue location dot, optionally with a light beam showing which way I face. */
export function meDotHtml(heading: number | null) {
  const beam =
    heading === null
      ? ""
      : `<div style="position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-56px 0 0 -28px;transform-origin:50% 100%;transform:rotate(${heading}deg);background:radial-gradient(circle at 50% 100%,rgba(66,133,244,.45),rgba(66,133,244,0) 70%);clip-path:polygon(50% 100%,12% 0,88% 0)"></div>`;
  return `<div style="position:relative;width:22px;height:22px">${beam}<div style="position:absolute;inset:0;border-radius:9999px;background:#4285F4;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div></div>`;
}

/** Google-style navigation arrow (points up; rotate it to my heading on screen). */
export function navArrowHtml(screenDeg: number) {
  return `<div style="width:44px;height:44px;transform:rotate(${screenDeg}deg);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><svg viewBox="0 0 44 44" width="44" height="44"><circle cx="22" cy="22" r="20" fill="#fff"/><path d="M22 7 L33 33 L22 27 L11 33 Z" fill="#4285F4"/></svg></div>`;
}

/** Red teardrop pin like Google Maps, for the place I am going to or have picked. */
export function teardropHtml(color = "#EA4335") {
  return `<svg viewBox="0 0 28 40" width="28" height="40" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M14 0C6.3 0 0 6.1 0 13.7 0 24 14 40 14 40s14-16 14-26.3C28 6.1 21.7 0 14 0z" fill="${color}" stroke="#a50e0e" stroke-width="1"/><circle cx="14" cy="14" r="5" fill="#7a0b0b"/></svg>`;
}

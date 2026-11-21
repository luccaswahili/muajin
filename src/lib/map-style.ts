/**
 * Look of our maps. Vector map from OpenFreeMap: free, no key, allowed for business use.
 * Markers are plain HTML; they point north and the map engine turns them.
 */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** Google-style blue location dot with a light beam showing which way I face. */
export function meDotHtml(withBeam: boolean) {
  const beam = withBeam
    ? `<div data-beam style="position:absolute;left:50%;bottom:50%;width:60px;height:60px;margin-left:-30px;background:radial-gradient(circle at 50% 100%,rgba(66,133,244,.5),rgba(66,133,244,0) 72%);clip-path:polygon(50% 100%,10% 0,90% 0)"></div>`
    : "";
  return `<div style="position:relative;width:22px;height:22px">${beam}<div style="position:absolute;inset:0;border-radius:9999px;background:#4285F4;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div></div>`;
}

/** Google-style navigation arrow, pointing north. */
export function navArrowHtml() {
  return `<div style="width:46px;height:46px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><svg viewBox="0 0 44 44" width="46" height="46"><circle cx="22" cy="22" r="20" fill="#fff"/><path d="M22 7 L33 33 L22 27 L11 33 Z" fill="#4285F4"/></svg></div>`;
}

/** Teardrop pin like Google Maps, for the customer I picked or am going to. */
export function teardropHtml(color = "#EA4335") {
  return `<svg viewBox="0 0 28 40" width="28" height="40" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M14 0C6.3 0 0 6.1 0 13.7 0 24 14 40 14 40s14-16 14-26.3C28 6.1 21.7 0 14 0z" fill="${color}" stroke="rgba(0,0,0,.25)" stroke-width="1"/><circle cx="14" cy="14" r="5" fill="rgba(0,0,0,.45)"/></svg>`;
}

/** Flat buildings instead of 3D blocks: lighter for cheaper phones and easier to read. */
export function flattenBuildings(m: { getLayer: (id: string) => unknown; removeLayer: (id: string) => void }) {
  if (m.getLayer("building-3d")) m.removeLayer("building-3d");
}

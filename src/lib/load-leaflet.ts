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

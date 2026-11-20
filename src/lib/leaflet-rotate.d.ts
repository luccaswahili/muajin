// Types for the leaflet-rotate plugin (adds map rotation to Leaflet).
import "leaflet";

declare module "leaflet" {
  interface MapOptions {
    rotate?: boolean;
    bearing?: number;
    touchRotate?: boolean;
    shiftKeyRotate?: boolean;
    rotateControl?: boolean | { closeOnZeroBearing?: boolean; position?: string };
  }
  interface Map {
    setBearing(degrees: number): this;
    getBearing(): number;
  }
}

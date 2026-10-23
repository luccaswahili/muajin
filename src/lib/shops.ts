export const REGIONS = [
  "Dar es Salaam", "Arusha", "Dodoma", "Geita", "Iringa", "Kagera", "Katavi", "Kigoma", "Kilimanjaro", "Lindi",
  "Manyara", "Mara", "Mbeya", "Morogoro", "Mtwara", "Mwanza", "Njombe", "Pwani", "Rukwa", "Ruvuma", "Shinyanga",
  "Simiyu", "Singida", "Songwe", "Tabora", "Tanga", "Kaskazini Unguja", "Kusini Unguja", "Mjini Magharibi",
  "Kaskazini Pemba", "Kusini Pemba",
];

export const SHOP_TYPES: Record<string, string> = {
  magi_shop: "Mangi shop",
  bar: "Bar",
  wholesaler: "Wholesaler",
  shop: "Shop / kiosk",
  other: "Other",
};

export const SHOP_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "Buying from us", color: "#16654a" },
  prospect: { label: "Not yet buying", color: "#c8932f" },
  not_interested: { label: "Not interested", color: "#9ca3af" },
};

/** Distance in km between two points. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function fmtDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function directionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

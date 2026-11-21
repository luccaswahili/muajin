/** The "my location" crosshair used on Google Maps. */
export function LocateIcon({ active = false, size = 24 }: { active?: boolean; size?: number }) {
  const c = active ? "#1A73E8" : "#5f6368";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="7" fill="none" stroke={c} strokeWidth="2" />
      <circle cx="12" cy="12" r="3.2" fill={active ? c : "none"} stroke={c} strokeWidth={active ? 0 : 2} />
      <path d="M12 1.5v3.5M12 19v3.5M1.5 12H5M19 12h3.5" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Shows which way north is; tap to turn the map back to north up. `bearing` is the map's turn in degrees. */
export function CompassButton({ bearing, onClick }: { bearing: number; onClick: () => void }) {
  const turned = Math.abs((((bearing % 360) + 540) % 360) - 180) > 1;
  return (
    <button
      onClick={onClick}
      className={`grid h-12 w-12 place-items-center rounded-full bg-white shadow-lg ${turned ? "" : "opacity-80"}`}
      aria-label="Turn map to north"
      title="Turn map to north"
    >
      <svg viewBox="0 0 24 24" width="26" height="26" style={{ transform: `rotate(${-bearing}deg)` }} aria-hidden="true">
        <path d="M12 2 L16 12 L12 10.5 L8 12 Z" fill="#dc2626" />
        <path d="M12 22 L8 12 L12 13.5 L16 12 Z" fill="#9ca3af" />
      </svg>
    </button>
  );
}

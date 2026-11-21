/** Google-Maps-style turn arrow for the navigation banner. */
export function TurnIcon({ type, modifier, size = 40 }: { type: string; modifier: string; size?: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let body: React.ReactNode;
  if (type === "arrive") {
    body = (
      <>
        <path d="M20 6c-5 0-9 3.9-9 8.8C11 21.5 20 33 20 33s9-11.5 9-18.2C29 9.9 25 6 20 6z" fill="currentColor" />
        <circle cx="20" cy="15" r="3.2" fill="#137333" />
      </>
    );
  } else if (type === "roundabout" || type === "rotary") {
    body = (
      <>
        <circle cx="20" cy="17" r="6.5" {...common} />
        <path d="M20 35V23.5" {...common} />
        <path d="M24.6 12.4 31 6M31 6h-6M31 6v6" {...common} />
      </>
    );
  } else {
    const m = modifier;
    const paths: Record<string, string> = {
      straight: "M20 34V7M12 15l8-8 8 8",
      "slight right": "M16 34V21l12-12M20 8h8v8",
      right: "M13 34V19c0-3 2-5 5-5h14M25 7l7 7-7 7",
      "sharp right": "M12 6v14c0 4 3 7 7 7h5l7-7M31 27v-7h-7",
      "slight left": "M24 34V21L12 9M20 8h-8v8",
      left: "M27 34V19c0-3-2-5-5-5H8M15 7l-7 7 7 7",
      "sharp left": "M28 6v14c0 4-3 7-7 7h-5l-7-7M9 27v-7h7",
      uturn: "M14 34V15a7 7 0 0 1 14 0v8M21 17l7 7 7-7",
    };
    body = <path d={paths[m] ?? paths.straight} {...common} />;
  }
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      {body}
    </svg>
  );
}

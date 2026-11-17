/** Shown the moment a link is tapped, while the next page loads. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-40 rounded-lg bg-gray-200" />
      <div className="h-24 rounded-xl bg-gray-100" />
      <div className="h-24 rounded-xl bg-gray-100" />
      <div className="h-24 rounded-xl bg-gray-100" />
    </div>
  );
}

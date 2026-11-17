import type { ReactNode } from "react";

/** Skeleton frames shown while a page loads, shaped like the page that is coming. */

type Cls = { className?: string };

export function Bone({ className = "" }: Cls) {
  return <div className={`skeleton ${className}`} />;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      {children}
    </div>
  );
}

/** Page title (and the green action button on the right). */
export function SkHeader({ button = true, subtitle = false }: { button?: boolean; subtitle?: boolean }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="space-y-2">
        {subtitle && <Bone className="h-3.5 w-28" />}
        <Bone className="h-7 w-40" />
      </div>
      {button && <Bone className="h-10 w-32 rounded-xl" />}
    </div>
  );
}

/** Row of number tiles (Stat). The first can be the dark green one. */
export function SkStats({ count = 4, cols = "grid-cols-2 md:grid-cols-4", brand = false }: { count?: number; cols?: string; brand?: boolean }) {
  return (
    <div className={`grid gap-3 ${cols}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`space-y-2 rounded-2xl border p-4 shadow-sm ${brand && i === 0 ? "border-brand-700 bg-brand-700" : "border-gray-200 bg-white"}`}>
          <Bone className={`h-3 w-20 ${brand && i === 0 ? "opacity-30" : ""}`} />
          <Bone className={`h-6 w-28 ${brand && i === 0 ? "opacity-30" : ""}`} />
          <Bone className={`h-3 w-16 ${brand && i === 0 ? "opacity-30" : ""}`} />
        </div>
      ))}
    </div>
  );
}

/** The white filter bar (dates, search). */
export function SkFilter({ fields = 2 }: { fields?: number }) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 shadow-sm">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-1">
          <Bone className="h-3 w-10" />
          <Bone className="h-9 w-36 rounded-xl" />
        </div>
      ))}
      <Bone className="h-9 w-20 rounded-xl" />
    </div>
  );
}

/** A white card with a list of rows: name and detail on the left, amount on the right. */
export function SkList({ rows = 6, title = true, avatar = false }: { rows?: number; title?: boolean; avatar?: boolean }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      {title && <Bone className="mb-4 h-4 w-32" />}
      <div className="divide-y divide-gray-100">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-3">
              {avatar && <Bone className="h-9 w-9 rounded-full" />}
              <div className="space-y-2">
                <Bone className={`h-4 ${["w-36", "w-44", "w-28", "w-40"][i % 4]}`} />
                <Bone className="h-3 w-24" />
              </div>
            </div>
            <div className="flex flex-col items-end space-y-2">
              <Bone className="h-4 w-20" />
              <Bone className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** A form card: labels and input boxes, then the big save button. */
export function SkForm({ fields = 5 }: { fields?: number }) {
  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Bone className="h-3.5 w-24" />
          <Bone className="h-11 w-full rounded-xl" />
        </div>
      ))}
      <Bone className="h-12 w-full rounded-xl" />
    </section>
  );
}

// ---------------------------------------------------------------- page frames

export function HomeSkeleton() {
  return (
    <Frame>
      <SkHeader subtitle />
      <SkStats count={8} brand />
      <SkList rows={4} />
    </Frame>
  );
}

export function ListPageSkeleton({ stats = 0, statCols, filter = 0, rows = 8, avatar = false }: { stats?: number; statCols?: string; filter?: number; rows?: number; avatar?: boolean }) {
  return (
    <Frame>
      <SkHeader />
      {filter > 0 && <SkFilter fields={filter} />}
      {stats > 0 && <SkStats count={stats} cols={statCols} />}
      <SkList rows={rows} title={false} avatar={avatar} />
    </Frame>
  );
}

export function FormPageSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <Frame>
      <SkHeader button={false} />
      <SkForm fields={fields} />
    </Frame>
  );
}

export function DetailSkeleton() {
  return (
    <Frame>
      <SkHeader subtitle />
      <SkStats count={2} cols="grid-cols-2" />
      <SkList rows={5} />
    </Frame>
  );
}

export function MapSkeleton() {
  return (
    <Frame>
      <div className="flex gap-2">
        <Bone className="h-8 w-28 rounded-full" />
        <Bone className="h-8 w-28 rounded-full" />
        <Bone className="h-8 w-24 rounded-full" />
      </div>
      <Bone className="h-[60vh] w-full rounded-2xl" />
    </Frame>
  );
}

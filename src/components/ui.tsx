import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-brand-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, children, className = "", action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold text-gray-900">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "brand" | "warn" | "danger"; href?: string }) {
  const tones = {
    default: "bg-white border-gray-200",
    brand: "bg-brand-700 border-brand-700 text-white",
    warn: "bg-amber-50 border-amber-200",
    danger: "bg-red-50 border-red-200",
  };
  const inner = (
    <div className={`h-full rounded-2xl border p-4 shadow-sm ${tones[tone]}`}>
      <div className={`text-xs font-medium uppercase tracking-wide ${tone === "brand" ? "text-brand-100" : "text-gray-500"}`}>{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      {hint && <div className={`mt-0.5 text-xs ${tone === "brand" ? "text-brand-100" : "text-gray-500"}`}>{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-500">{children}</p>;
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "green" | "amber" | "red" | "blue" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-700",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
    blue: "bg-sky-100 text-sky-800",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Row({ children, href }: { children: ReactNode; href?: string }) {
  const cls = "flex items-center justify-between gap-3 py-3";
  return href ? (
    <Link href={href} className={`${cls} -mx-2 rounded-lg px-2 hover:bg-gray-50`}>{children}</Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-gray-100">{children}</div>;
}

"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createProduction } from "@/app/actions";
import { num } from "@/lib/format";

type Product = { id: string; name: string; bottles_per_carton: number; bottle_ml: number };
type Material = { material_id: string; name: string; unit: string; qty: number; usage: string; usage_qty: number; product_id: string | null };
type Damaged = { material_id: string; qty: string; note: string };

const USAGE_LABEL: Record<string, string> = { per_bottle: "per bottle", per_carton: "per carton", per_drum: "per drum" };

export function ProductionForm({
  products, materials, date, expectedPerDrum, drumLitres, nextBatch,
}: {
  products: Product[]; materials: Material[]; date: string; expectedPerDrum: number; drumLitres: number; nextBatch: number;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [drums, setDrums] = useState("1");
  const [cartons, setCartons] = useState(String(expectedPerDrum));
  const [loose, setLoose] = useState("0");
  const [damaged, setDamaged] = useState<Damaged[]>([]);
  const p = products.find((x) => x.id === productId);

  const d = Number(drums || 0);
  const c = Number(cartons || 0);
  const l = Number(loose || 0);
  const perCarton = p?.bottles_per_carton ?? 30;
  const bottles = c * perCarton + l;
  const liquidL = (bottles * (p?.bottle_ml ?? 200)) / 1000;
  const ethanolL = d * drumLitres;

  const used = materials
    .filter((m) => m.usage !== "none" && Number(m.usage_qty) > 0 && (!m.product_id || m.product_id === productId))
    .map((m) => {
      const qty = m.usage === "per_bottle" ? bottles * m.usage_qty : m.usage === "per_carton" ? c * m.usage_qty : d * m.usage_qty;
      const lost = damaged.filter((x) => x.material_id === m.material_id).reduce((a, x) => a + Number(x.qty || 0), 0);
      return { ...m, use: Math.round(qty * 100) / 100, lost };
    })
    .filter((m) => m.use > 0);
  const flavorL = used.filter((m) => /flavo/i.test(m.name) && /^l/i.test(m.unit)).reduce((a, m) => a + m.use, 0);
  const waterL = Math.max(0, liquidL - ethanolL - flavorL);
  const damagedOnly = damaged.filter((x) => x.material_id && !used.some((u) => u.material_id === x.material_id));

  return (
    <ActionForm action={createProduction} className="space-y-4" reset={false}>
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="drums" value={drums} />
      <input type="hidden" name="cartons" value={cartons} />
      <input type="hidden" name="loose_bottles" value={loose} />
      <input type="hidden" name="damaged" value={JSON.stringify(damaged.filter((x) => x.material_id && Number(x.qty) > 0))} />

      <div className="rounded-xl bg-brand-700 px-4 py-3 text-white">
        <div className="text-xs uppercase tracking-wide text-brand-100">New batch</div>
        <div className="text-2xl font-bold">Batch #{nextBatch}</div>
      </div>

      <div className={step === 1 ? "space-y-4" : "hidden"}>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Product</span>
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-sm font-medium">Ethanol drums<input inputMode="decimal" className="input mt-1 text-lg font-semibold" value={drums} onChange={(e) => setDrums(e.target.value)} /></label>
          <label className="text-sm font-medium">Cartons made<input inputMode="numeric" className="input mt-1 text-lg font-semibold" value={cartons} onChange={(e) => setCartons(e.target.value.replace(/\D/g, ""))} /></label>
          <label className="text-sm font-medium">Loose bottles<input inputMode="numeric" className="input mt-1 text-lg font-semibold" value={loose} onChange={(e) => setLoose(e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
          <div className="font-semibold">{num(bottles)} bottles = {num(liquidL)} L of gin</div>
          <div>Ethanol {num(ethanolL)} L ({liquidL ? num((ethanolL / liquidL) * 100, 1) : 0}%) · Flavor {num(flavorL, 2)} L · Water ≈ {num(waterL)} L</div>
          {d > 0 && <div>{num(c / d, 1)} cartons per drum (expected {expectedPerDrum})</div>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-medium">Workers paid (TZS)<input name="labour_cost" inputMode="numeric" className="input mt-1" placeholder="0" /></label>
          <label className="text-sm font-medium">Paid from
            <select name="labour_paid_from" className="input mt-1"><option value="cash">Cash</option><option value="bank">Bank</option></select>
          </label>
          <label className="text-sm">Date<input type="date" name="date" defaultValue={date} className="input mt-1" /></label>
          <label className="text-sm">Note<input name="notes" className="input mt-1" placeholder="Optional" /></label>
        </div>
        <button type="button" className="btn-primary w-full" disabled={!productId || bottles <= 0} onClick={() => setStep(2)}>
          Next: check materials
        </button>
      </div>

      {step === 2 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Taken from stock automatically</span>
              <button type="button" className="text-sm text-brand-600" onClick={() => setStep(1)}>Edit numbers</button>
            </div>
            <p className="mb-2 text-xs text-gray-500">{p?.name} · {num(d, 2)} drum{d === 1 ? "" : "s"} · {c} cartons{l ? ` + ${l} bottles` : ""}</p>
            <div className="divide-y divide-gray-100 text-sm">
              {used.map((m) => {
                const after = Number(m.qty) - m.use - m.lost;
                return (
                  <div key={m.material_id} className="flex items-center justify-between py-2">
                    <div>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-gray-500">{num(m.usage_qty, 4)} {m.unit} {USAGE_LABEL[m.usage]}{m.lost ? ` · +${num(m.lost, 2)} damaged` : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold tabular-nums text-red-700">−{num(m.use + m.lost, 2)} {m.unit}</div>
                      <div className={`text-xs ${after < 0 ? "font-semibold text-red-600" : "text-gray-500"}`}>stock {num(m.qty, 2)} → {num(after, 2)}</div>
                    </div>
                  </div>
                );
              })}
              {damagedOnly.map((x, i) => {
                const m = materials.find((mm) => mm.material_id === x.material_id);
                return (
                  <div key={"d" + i} className="flex items-center justify-between py-2">
                    <div className="font-medium">{m?.name} <span className="text-xs text-gray-500">(damaged)</span></div>
                    <div className="font-semibold tabular-nums text-red-700">−{num(Number(x.qty || 0), 2)} {m?.unit}</div>
                  </div>
                );
              })}
            </div>
            {used.some((m) => Number(m.qty) - m.use - m.lost < 0) && (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                Some items will go below zero. That usually means their stock was never entered. You can still save, then fix it on the Stock page.
              </p>
            )}
            {used.length === 0 && <p className="text-sm text-gray-500">No materials are set to be used automatically. Luca can set this in Admin → Materials.</p>}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="font-semibold">Anything destroyed during production?</div>
            <p className="mb-2 text-xs text-gray-500">Broken bottles, torn labels, wasted stamps, damaged boxes… These are also taken from stock.</p>
            <div className="space-y-2">
              {damaged.map((x, i) => (
                <div key={i} className="grid grid-cols-[1fr_5rem_auto] gap-2">
                  <select className="input" value={x.material_id} onChange={(e) => setDamaged(damaged.map((y, j) => (j === i ? { ...y, material_id: e.target.value } : y)))}>
                    <option value="">Choose item</option>
                    {materials.map((m) => <option key={m.material_id} value={m.material_id}>{m.name}</option>)}
                  </select>
                  <input className="input" inputMode="decimal" placeholder="Qty" value={x.qty} onChange={(e) => setDamaged(damaged.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
                  <button type="button" className="btn-secondary !px-3" onClick={() => setDamaged(damaged.filter((_, j) => j !== i))}>×</button>
                  <input className="input col-span-3" placeholder="What happened? (optional)" value={x.note} onChange={(e) => setDamaged(damaged.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} />
                </div>
              ))}
            </div>
            <button type="button" className="btn-secondary mt-2 w-full" onClick={() => setDamaged([...damaged, { material_id: "", qty: "", note: "" }])}>
              + Add damaged item
            </button>
          </div>

          <p className="text-xs text-gray-500">
            On approval: {c} cartons{l ? ` + ${l} bottles` : ""} are added to {p?.name} stock, the materials above are deducted, and every change is noted as &quot;batch #{nextBatch}&quot;.
          </p>
          <SubmitButton>Approve batch #{nextBatch}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

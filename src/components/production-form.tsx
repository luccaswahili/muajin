"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createProduction } from "@/app/actions";
import { num } from "@/lib/format";

type Product = { id: string; name: string; bottles_per_carton: number; bottle_ml: number };
type Material = { id: string; name: string };

export function ProductionForm({
  products, flavors, date, expectedPerDrum, drumLitres, ethanolPct, flavorPct,
}: {
  products: Product[]; flavors: Material[]; date: string; expectedPerDrum: number; drumLitres: number; ethanolPct: number; flavorPct: number;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [drums, setDrums] = useState("1");
  const [cartons, setCartons] = useState("");
  const p = products.find((x) => x.id === productId);
  const d = Number(drums || 0);
  const ethanolL = d * drumLitres;
  const totalL = ethanolPct > 0 ? ethanolL / (ethanolPct / 100) : 0;
  const bottlesPossible = p ? Math.floor((totalL * 1000) / p.bottle_ml) : 0;
  const cartonsPossible = p ? Math.floor(bottlesPossible / p.bottles_per_carton) : 0;
  const defaultFlavor = flavors.find((f) => p && f.name.toLowerCase().includes(p.name.toLowerCase().replace("muajin", "").trim().split(" ")[0] ?? ""));

  return (
    <ActionForm action={createProduction} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Product</span>
        <select name="product_id" className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
          {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-sm font-medium">Drums used<input name="drums" inputMode="decimal" className="input mt-1" value={drums} onChange={(e) => setDrums(e.target.value)} /></label>
        <label className="text-sm font-medium">Cartons made<input name="cartons" inputMode="numeric" className="input mt-1" value={cartons} placeholder={String(Math.round(d * expectedPerDrum))} onChange={(e) => setCartons(e.target.value)} required /></label>
        <label className="text-sm font-medium">Extra bottles<input name="loose_bottles" inputMode="numeric" className="input mt-1" placeholder="0" /></label>
      </div>
      <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
        <div className="font-semibold">Mix guide for {num(d, 2)} drum{d === 1 ? "" : "s"}</div>
        <div>Ethanol {num(ethanolL)} L ({ethanolPct}%) · Flavor {num(totalL * flavorPct / 100, 2)} L ({flavorPct}%) · Water {num(totalL - ethanolL - totalL * flavorPct / 100)} L</div>
        <div>Total liquid ≈ {num(totalL)} L → up to {num(cartonsPossible)} cartons. Expected {num(d * expectedPerDrum)}.</div>
        {cartons && d > 0 && <div className="mt-1 font-medium">This batch: {num(Number(cartons) / d, 1)} cartons per drum</div>}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="use_materials" defaultChecked className="mt-1" />
        <span>Take ethanol, flavor, bottles, caps, labels and boxes out of materials stock</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Flavor used</span>
        <select name="flavor_material_id" className="input" key={productId} defaultValue={defaultFlavor?.id ?? ""}>
          <option value="">Don&apos;t track flavor</option>
          {flavors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-medium">Workers paid (TZS)<input name="labour_cost" inputMode="numeric" className="input mt-1" placeholder="0" /></label>
        <label className="text-sm font-medium">Paid from
          <select name="labour_paid_from" className="input mt-1"><option value="cash">Cash</option><option value="bank">Bank</option></select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">Date<input type="date" name="date" defaultValue={date} className="input mt-1" /></label>
        <label className="text-sm">Note<input name="notes" className="input mt-1" placeholder="Optional" /></label>
      </div>
      <p className="text-xs text-gray-500">You can add transport and other costs for this batch on the next screen.</p>
      <SubmitButton>Confirm production</SubmitButton>
    </ActionForm>
  );
}

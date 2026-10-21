"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createExpense } from "@/app/actions";

type Opt = { id: string; name: string };
type Material = Opt & { unit: string };
type Production = { id: string; label: string };

export function ExpenseForm({
  categories, materials, productions, date, productionId,
}: {
  categories: Opt[]; materials: Material[]; productions: Production[]; date: string; productionId?: string;
}) {
  const [material, setMaterial] = useState("");
  const unit = materials.find((m) => m.id === material)?.unit;
  return (
    <ActionForm action={createExpense} className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-medium">Amount (TZS)<input name="amount" inputMode="numeric" className="input mt-1 text-lg font-semibold" required /></label>
        <label className="text-sm font-medium">Category
          <select name="category_id" className="input mt-1" required>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">What was it for?<input name="description" className="input mt-1" placeholder="e.g. Transport of ethanol drum from Dar" /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm font-medium">Paid from
          <select name="paid_from" className="input mt-1">
            <option value="cash">Cash I&apos;m holding</option>
            <option value="bank">Muwa Gin bank account</option>
          </select>
        </label>
        <label className="text-sm font-medium">Date<input type="date" name="date" defaultValue={date} className="input mt-1" /></label>
      </div>
      {productionId ? (
        <input type="hidden" name="production_id" value={productionId} />
      ) : (
        <label className="block text-sm font-medium">For a production batch? (optional)
          <select name="production_id" className="input mt-1">
            <option value="">No</option>
            {productions.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      )}
      <details className="rounded-xl border border-gray-200 bg-white p-3" open={!!material}>
        <summary className="cursor-pointer text-sm text-gray-600">Bought materials? Add them to stock</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs">Item
            <select name="material_id" className="input mt-1" value={material} onChange={(e) => setMaterial(e.target.value)}>
              <option value="">None</option>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="text-xs">Quantity {unit ? `(${unit})` : ""}<input name="material_qty" inputMode="decimal" className="input mt-1" disabled={!material} required={!!material} placeholder={unit === "litre" ? "250 for one drum" : ""} /></label>
        </div>
        {material && (
          <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name="update_unit_cost" defaultChecked /> Use this as the new cost price for this item</label>
        )}
      </details>
      <SubmitButton>Save expense</SubmitButton>
    </ActionForm>
  );
}

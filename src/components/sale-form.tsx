"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createSale, searchCustomers, type CustomerHit } from "@/app/actions";
import { tzs } from "@/lib/format";

type Product = { product_id: string; name: string; price_carton: number; price_bottle: number; bottles_per_carton: number; cartons: number; loose_bottles: number };
type Customer = { id: string; name: string; phone: string; balance: number };

export function SaleForm({ products, customers, date, customerId = "" }: { products: Product[]; customers: Customer[]; date: string; customerId?: string }) {
  const [productId, setProductId] = useState(products[0]?.product_id ?? "");
  const product = products.find((p) => p.product_id === productId);
  const [cartons, setCartons] = useState("1");
  const [bottles, setBottles] = useState("");
  const [priceCarton, setPriceCarton] = useState<string | null>(null);
  const [priceBottle, setPriceBottle] = useState<string | null>(null);
  const [discount, setDiscount] = useState("");
  const [customer, setCustomer] = useState(customerId);
  const [paidMode, setPaidMode] = useState<"full" | "part" | "none">("full");
  const [paid, setPaid] = useState("");

  const pc = Number(priceCarton ?? product?.price_carton ?? 0);
  const pb = Number(priceBottle ?? product?.price_bottle ?? 0);
  const total = Math.max(0, Number(cartons || 0) * pc + Number(bottles || 0) * pb - Number(discount || 0));
  const amountPaid = paidMode === "full" ? total : paidMode === "none" ? 0 : Number(paid || 0);

  return (
    <ActionForm action={createSale} className="space-y-4">
      <input type="hidden" name="amount_paid" value={amountPaid} />
      <div className="grid grid-cols-2 gap-2">
        {products.map((p) => (
          <button
            type="button"
            key={p.product_id}
            onClick={() => {
              setProductId(p.product_id);
              setPriceCarton(null);
              setPriceBottle(null);
            }}
            className={`rounded-xl border p-3 text-left ${p.product_id === productId ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-gray-200 bg-white"}`}
          >
            <div className="text-sm font-semibold">{p.name}</div>
            <div className="text-xs text-gray-500">In stock: {p.cartons} ctn{p.loose_bottles ? ` + ${p.loose_bottles} btl` : ""}</div>
          </button>
        ))}
      </div>
      <input type="hidden" name="product_id" value={productId} />

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Cartons</span>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-secondary !px-3" onClick={() => setCartons(String(Math.max(0, Number(cartons || 0) - 1)))}>−</button>
            <input name="cartons" inputMode="numeric" className="input text-center text-lg font-semibold" value={cartons} onChange={(e) => setCartons(e.target.value.replace(/\D/g, ""))} />
            <button type="button" className="btn-secondary !px-3" onClick={() => setCartons(String(Number(cartons || 0) + 1))}>+</button>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Loose bottles</span>
          <input name="bottles" inputMode="numeric" className="input text-center text-lg font-semibold" placeholder="0" value={bottles} onChange={(e) => setBottles(e.target.value.replace(/\D/g, ""))} />
        </label>
      </div>

      <details className="rounded-xl border border-gray-200 bg-white p-3">
        <summary className="cursor-pointer text-sm text-gray-600">
          Price: {tzs(pc)} per carton · {tzs(pb)} per bottle (tap to change for this sale)
        </summary>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="text-xs">Per carton<input name="price_carton" inputMode="numeric" className="input mt-1" value={priceCarton ?? String(product?.price_carton ?? "")} onChange={(e) => setPriceCarton(e.target.value)} /></label>
          <label className="text-xs">Per bottle<input name="price_bottle" inputMode="numeric" className="input mt-1" value={priceBottle ?? String(product?.price_bottle ?? "")} onChange={(e) => setPriceBottle(e.target.value)} /></label>
          <label className="text-xs">Discount<input name="discount" inputMode="numeric" className="input mt-1" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
        </div>
      </details>

      <div className="rounded-2xl bg-brand-700 p-4 text-white">
        <div className="text-xs uppercase tracking-wide text-brand-100">Total</div>
        <div className="text-3xl font-bold tabular-nums">{tzs(total)}</div>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium">Customer</span>
        <input type="hidden" name="customer_id" value={customer} />
        <CustomerPicker customers={customers} value={customer} onChange={setCustomer} />
      </div>
      {customer === "new" && (
        <div className="grid grid-cols-2 gap-2">
          <input name="new_customer_name" className="input" placeholder="Customer name" required />
          <input name="new_customer_phone" className="input" placeholder="Phone" inputMode="tel" />
        </div>
      )}

      <div>
        <span className="mb-1 block text-sm font-medium">Payment</span>
        <div className="grid grid-cols-3 gap-2">
          {(["full", "part", "none"] as const).map((m) => (
            <button type="button" key={m} onClick={() => setPaidMode(m)} className={`rounded-xl border px-2 py-2 text-sm ${paidMode === m ? "border-brand-500 bg-brand-50 font-semibold text-brand-700" : "border-gray-200 bg-white"}`}>
              {m === "full" ? "Paid in full" : m === "part" ? "Part paid" : "On credit"}
            </button>
          ))}
        </div>
        {paidMode === "part" && (
          <input className="input mt-2" inputMode="numeric" placeholder="Amount paid now" value={paid} onChange={(e) => setPaid(e.target.value)} />
        )}
        {paidMode !== "full" && total - amountPaid > 0 && (
          <p className="mt-1 text-xs text-amber-700">Customer will owe {tzs(total - amountPaid)}. Pick or add a customer.</p>
        )}
      </div>

      {amountPaid > 0 && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Paid by</span>
          <select name="method" className="input" defaultValue="cash">
            <option value="cash">Cash (I am holding it)</option>
            <option value="mobile_money">Mobile money (to my phone)</option>
            <option value="bank">Straight to Muwa Gin bank account</option>
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">Date<input type="date" name="date" defaultValue={date} className="input mt-1" /></label>
        <label className="text-sm">Note<input name="notes" className="input mt-1" placeholder="Optional" /></label>
      </div>

      <SubmitButton>Save sale · {tzs(total)}</SubmitButton>
      <Link href="/sales" className="block text-center text-sm text-gray-500">See all sales</Link>
    </ActionForm>
  );
}

function CustomerPicker({ customers, value, onChange }: { customers: Customer[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<Customer | null>(customers.find((c) => c.id === value) ?? null);

  // Search on the server as the user types (works with thousands of customers)
  useEffect(() => {
    const text = q.trim();
    if (!text) return;
    let stale = false;
    const t = setTimeout(async () => {
      setSearching(true);
      const hits = await searchCustomers(text);
      if (!stale) {
        setResults(hits);
        setSearching(false);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);

  const pick = (v: string, c: Customer | null = null) => {
    onChange(v);
    setChosen(c);
    setOpen(false);
    setQ("");
    setResults([]);
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="input flex items-center justify-between text-left">
        <span className="min-w-0 truncate">
          {chosen && value === chosen.id ? (
            <>
              <span className="font-medium">{chosen.name}</span>
              {chosen.phone && <span className="text-gray-500"> · {chosen.phone}</span>}
              {Number(chosen.balance) > 0 && <span className="text-amber-700"> · owes {tzs(chosen.balance)}</span>}
            </>
          ) : value === "new" ? (
            "+ New customer"
          ) : (
            "Walk-in (no name)"
          )}
        </span>
        <span className="shrink-0 text-sm text-brand-600">🔍 {value && value !== "new" ? "Change" : "Search"}</span>
      </button>
    );
  }

  const shown = q.trim() ? results : [];
  return (
    <div className="rounded-xl border border-brand-300 bg-white p-2 ring-2 ring-brand-100">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="input"
        placeholder="Search by name or phone number"
        inputMode="search"
      />
      <div className="mt-1 divide-y divide-gray-100">
        {shown.map((c) => (
          <button type="button" key={c.id} onClick={() => pick(c.id, c)} className="flex w-full items-center justify-between gap-2 px-1 py-2 text-left">
            <span className="min-w-0">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block text-xs text-gray-500">{[c.phone || "No phone", c.area].filter(Boolean).join(" · ")}</span>
            </span>
            {Number(c.balance) > 0 && <span className="shrink-0 text-xs text-amber-700">owes {tzs(c.balance)}</span>}
          </button>
        ))}
        {q.trim() && !searching && shown.length === 0 && <p className="px-1 py-2 text-sm text-gray-500">No customer found.</p>}
        {searching && <p className="px-1 py-2 text-sm text-gray-400">Searching…</p>}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => pick("new")} className="btn-secondary !py-2 text-sm">+ New customer</button>
        <button type="button" onClick={() => pick("")} className="btn-secondary !py-2 text-sm">Walk-in (no name)</button>
      </div>
    </div>
  );
}

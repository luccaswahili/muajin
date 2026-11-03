"use client";

import { useState, type ReactNode } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { moveAgentStock } from "@/app/actions";

type Agent = { id: string; name: string };
type Product = { product_id: string; name: string; bottles_per_carton: number };

/** "Release" for owners: the gin leaving the warehouse is either sold now or taken by an agent. */
export function ReleaseTabs({ sale, agentTake }: { sale: ReactNode; agentTake: ReactNode }) {
  const [mode, setMode] = useState<"sale" | "take">("sale");
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {([["sale", "Sale", "Sold to a customer now"], ["take", "Agent take", "An agent takes it to sell"]] as const).map(([k, label, hint]) => (
          <button
            key={k}
            type="button"
            onClick={() => setMode(k)}
            className={`rounded-xl border-2 p-3 text-left ${mode === k ? "border-brand-600 bg-brand-50" : "border-gray-200 bg-white"}`}
          >
            <div className={`font-semibold ${mode === k ? "text-brand-800" : ""}`}>{label}</div>
            <div className="text-xs text-gray-500">{hint}</div>
          </button>
        ))}
      </div>
      <div className={mode === "sale" ? "" : "hidden"}>{sale}</div>
      <div className={mode === "take" ? "" : "hidden"}>{agentTake}</div>
    </div>
  );
}

/** Release gin to an agent, or record what an agent brought back. */
export function AgentStockForm({ agents, products, date, direction = "release", agentId }: {
  agents: Agent[]; products: Product[]; date: string; direction?: "release" | "return"; agentId?: string;
}) {
  const back = direction === "return";
  if (!agents.length) return <p className="text-sm text-gray-500">No sales agents yet. In Admin, give someone the “Sales agent” role.</p>;
  return (
    <ActionForm action={moveAgentStock} className="space-y-3">
      <input type="hidden" name="direction" value={direction} />
      {agentId ? (
        <input type="hidden" name="agent_id" value={agentId} />
      ) : (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Agent</span>
          <select name="agent_id" className="input" required defaultValue="">
            <option value="" disabled>Choose agent</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Product</span>
        <select name="product_id" className="input" required>
          {products.map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">Cartons<input name="cartons" inputMode="numeric" className="input mt-1" defaultValue={back ? "" : "1"} placeholder="0" /></label>
        <label className="text-sm">Loose bottles<input name="bottles" inputMode="numeric" className="input mt-1" placeholder="0" /></label>
        <label className="text-sm">Date<input type="date" name="date" defaultValue={date} className="input mt-1" /></label>
        <label className="text-sm">Note<input name="notes" className="input mt-1" placeholder="Optional" /></label>
      </div>
      <SubmitButton className={back ? "btn-secondary w-full" : "btn-primary w-full"}>{back ? "Record return to warehouse" : "Release to agent"}</SubmitButton>
      {!back && <p className="text-xs text-gray-500">This leaves the warehouse but is not a sale. It stays in the agent&apos;s hold until they sell it or bring it back.</p>}
    </ActionForm>
  );
}

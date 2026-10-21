import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, List, PageHeader, Row, Stat } from "@/components/ui";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { createDeposit, createTransfer, deleteRecord, recordCashAdjustment, reviewDeposit } from "@/app/actions";
import { fmtDate, today, tzs } from "@/lib/format";

export const metadata = { title: "Bank & cash" };

type Entry = { date: string; label: string; amount: number; key: string };

export default async function MoneyPage() {
  const me = await requirePerm("bank");
  const supabase = await createClient();
  const [fin, holders, deposits, bankPayments, bankExpenses, withdrawals, members, bankName, adjustments] = await Promise.all([
    supabase.from("v_finance_summary").select("*").single(),
    supabase.from("v_cash_holders").select("*").order("cash_in_hand", { ascending: false }),
    supabase.from("v_deposits").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(50),
    supabase.from("payments").select("id, date, amount, customer:customers(name)").eq("method", "bank").order("date", { ascending: false }).limit(50),
    supabase.from("v_expenses").select("id, date, amount, description, category_name").eq("paid_from", "bank").order("date", { ascending: false }).limit(50),
    supabase.from("owner_withdrawals").select("id, date, amount, paid_from, owner:owners(name)").order("date", { ascending: false }).limit(50),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
    supabase.from("settings").select("value").eq("key", "bank_name").maybeSingle(),
    supabase.from("cash_adjustments").select("*, member:profiles!cash_adjustments_profile_id_fkey(full_name, email)").order("created_at", { ascending: false }).limit(20),
  ]);
  const f = fin.data ?? { bank_balance: 0, cash_in_hand: 0, pending_deposits: 0, receivables: 0 };
  const pending = (deposits.data ?? []).filter((d) => d.status === "pending");
  const history = (deposits.data ?? []).filter((d) => d.status !== "pending");
  const myCash = Number((holders.data ?? []).find((h) => h.profile_id === me.id)?.cash_in_hand ?? 0);

  const ledger: Entry[] = [
    ...history.filter((d) => d.status === "confirmed").map((d) => ({ key: "d" + d.id, date: d.date, label: `Deposit by ${d.deposited_by_name}${d.reference ? ` · ${d.reference}` : ""}`, amount: Number(d.amount) })),
    ...(bankPayments.data ?? []).map((p) => {
      const c = Array.isArray(p.customer) ? p.customer[0] : p.customer;
      return { key: "p" + p.id, date: p.date, label: `Customer paid to bank${c?.name ? ` · ${c.name}` : ""}`, amount: Number(p.amount) };
    }),
    ...(bankExpenses.data ?? []).map((e) => ({ key: "e" + e.id, date: e.date, label: `${e.category_name}${e.description ? ` · ${e.description}` : ""}`, amount: -Number(e.amount) })),
    ...(withdrawals.data ?? []).filter((w) => w.paid_from === "bank").map((w) => {
      const o = Array.isArray(w.owner) ? w.owner[0] : w.owner;
      return { key: "w" + w.id, date: w.date, label: `Owner withdrawal · ${o?.name}`, amount: -Number(w.amount) };
    }),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);

  return (
    <div className="space-y-4">
      <PageHeader title="Bank & cash" subtitle={String(bankName.data?.value ?? "Muwa Gin official account")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat tone="brand" label="Bank balance" value={tzs(f.bank_balance)} />
        <Stat label="Cash not banked" value={tzs(f.cash_in_hand)} tone={Number(f.cash_in_hand) > 0 ? "warn" : "default"} />
        <Stat label="Waiting confirmation" value={tzs(f.pending_deposits)} hint={`${pending.length} deposit${pending.length === 1 ? "" : "s"}`} />
        <Stat label="I am holding" value={tzs(myCash)} />
      </div>

      {pending.length > 0 && (
        <Card title="Deposits waiting for confirmation">
          <p className="mb-2 text-xs text-gray-500">Check the bank statement or slip, then confirm. Only after confirmation does the bank balance go up.</p>
          <List>
            {pending.map((d) => {
              const canReview = d.deposited_by !== me.id || me.is_admin;
              return (
                <Row key={d.id}>
                  <div>
                    <div className="font-semibold">{tzs(d.amount)}</div>
                    <div className="text-xs text-gray-500">{d.deposited_by_name} · {fmtDate(d.date)}{d.reference ? ` · ref ${d.reference}` : ""}</div>
                  </div>
                  <div className="flex gap-1">
                    {canReview ? (
                      <>
                        <InlineAction action={reviewDeposit} fields={{ id: d.id, approve: "true" }} label="Confirm" className="btn-primary !px-3 !py-1.5" />
                        <InlineAction action={reviewDeposit} fields={{ id: d.id, approve: "false" }} label="Reject" className="btn-danger !px-3 !py-1.5" confirm="Reject this deposit? The money goes back to the person's cash in hand." />
                      </>
                    ) : (
                      <>
                        <Badge tone="amber">Needs someone else</Badge>
                        <InlineAction action={deleteRecord} fields={{ table: "deposits", id: d.id }} label="Cancel" className="text-xs text-red-600" confirm="Cancel this deposit?" />
                      </>
                    )}
                  </div>
                </Row>
              );
            })}
          </List>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Who is holding cash">
          <List>
            {(holders.data ?? []).map((h) => (
              <Row key={h.profile_id}>
                <span>{h.full_name || h.email}{h.profile_id === me.id && " (me)"}</span>
                <span className={`font-semibold tabular-nums ${Number(h.cash_in_hand) < 0 ? "text-red-600" : ""}`}>{tzs(h.cash_in_hand)}</span>
              </Row>
            ))}
          </List>
          <p className="mt-2 text-xs text-gray-500">Cash collected from sales, minus cash spent on expenses, minus deposits. A negative number means the person paid company costs from their own pocket.</p>
        </Card>

        <Card title="I deposited to the bank">
          <div id="deposit" />
          <ActionForm action={createDeposit}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Amount (TZS)"><input name="amount" inputMode="numeric" className="input" defaultValue={myCash > 0 ? myCash : undefined} required /></Field>
              <Field label="Date"><input type="date" name="date" defaultValue={today()} className="input" /></Field>
            </div>
            <Field label="Slip / reference number"><input name="reference" className="input" /></Field>
            <SubmitButton>Record deposit</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      {me.is_admin && (
        <Card title="Adjust cash not banked (admin only)">
          <ActionForm action={recordCashAdjustment}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Field label="Whose cash">
                <select name="profile_id" className="input" defaultValue={me.id}>
                  {(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                </select>
              </Field>
              <Field label="Add or subtract">
                <select name="direction" className="input"><option value="add">Add (+)</option><option value="subtract">Subtract (−)</option></select>
              </Field>
              <Field label="Amount (TZS)"><input name="amount" inputMode="numeric" className="input" required /></Field>
              <Field label="Date"><input type="date" name="date" defaultValue={today()} className="input" /></Field>
            </div>
            <Field label="Reason"><input name="notes" className="input" placeholder="e.g. Opening cash, counting correction" required /></Field>
            <SubmitButton className="btn-secondary w-full">Save adjustment</SubmitButton>
          </ActionForm>
          {!!adjustments.data?.length && (
            <div className="mt-3 border-t pt-2">
              {adjustments.data.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{a.member?.full_name || a.member?.email} · {a.notes}</div>
                    <div className="text-xs text-gray-500">{fmtDate(a.date)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`tabular-nums ${Number(a.amount) < 0 ? "text-red-600" : "text-emerald-700"}`}>{tzs(a.amount, { sign: true })}</span>
                    <InlineAction action={deleteRecord} fields={{ table: "cash_adjustments", id: a.id }} label="×" className="text-red-600" confirm="Undo this adjustment?" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card title="Hand cash to another member">
        <ActionForm action={createTransfer}>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="From">
              <select name="from" className="input" defaultValue={me.id}>
                {(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
              </select>
            </Field>
            <Field label="To">
              <select name="to" className="input" required>
                {(members.data ?? []).filter((m) => m.id !== me.id).map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
              </select>
            </Field>
            <Field label="Amount"><input name="amount" inputMode="numeric" className="input" required /></Field>
            <Field label="Date"><input type="date" name="date" defaultValue={today()} className="input" /></Field>
          </div>
          <SubmitButton className="btn-secondary w-full">Record handover</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="Bank account history">
        {ledger.length ? (
          <List>
            {ledger.map((e) => (
              <Row key={e.key}>
                <div className="min-w-0">
                  <div className="truncate text-sm">{e.label}</div>
                  <div className="text-xs text-gray-500">{fmtDate(e.date)}</div>
                </div>
                <span className={`font-semibold tabular-nums ${e.amount < 0 ? "text-red-600" : "text-emerald-700"}`}>{tzs(e.amount, { sign: true })}</span>
              </Row>
            ))}
          </List>
        ) : (
          <Empty>Nothing in the bank yet. Balance starts at 0.</Empty>
        )}
      </Card>

      {history.some((d) => d.status === "rejected") && (
        <Card title="Rejected deposits">
          <List>
            {history.filter((d) => d.status === "rejected").map((d) => (
              <Row key={d.id}>
                <span className="text-sm">{d.deposited_by_name} · {fmtDate(d.date)} · rejected by {d.confirmed_by_name}</span>
                <span className="tabular-nums">{tzs(d.amount)}</span>
              </Row>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}

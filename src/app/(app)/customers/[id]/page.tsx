import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { can, requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Field, List, PageHeader, Row, Stat } from "@/components/ui";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { deleteRecord, recordCustomerPayment, saveCustomer } from "@/app/actions";
import { METHOD_LABEL, fmtDate, qty, today, tzs } from "@/lib/format";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  if (!can(me, "sales") && !can(me, "customers")) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data: c } = await supabase.from("v_customer_balances").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: sales }, { data: payments }] = await Promise.all([
    supabase.from("v_sales").select("*").eq("customer_id", id).order("date", { ascending: false }),
    supabase.from("payments").select("*").eq("customer_id", id).order("date", { ascending: false }),
  ]);
  const owes = Number(c.balance) > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={c.name} subtitle={[c.phone, c.location].filter(Boolean).join(" · ")} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Bought" value={tzs(c.total_bought)} />
        <Stat label="Paid" value={tzs(c.total_paid)} />
        <Stat label="Owes" value={tzs(c.balance)} tone={owes ? "warn" : "default"} />
      </div>
      {owes && can(me, "sales") && (
        <Card title="Record a payment">
          <ActionForm action={recordCustomerPayment}>
            <input type="hidden" name="customer_id" value={c.id} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Amount"><input name="amount" inputMode="numeric" className="input" defaultValue={Number(c.balance)} required /></Field>
              <Field label="Paid by">
                <select name="method" className="input">
                  <option value="cash">Cash (I hold it)</option>
                  <option value="mobile_money">Mobile money</option>
                  <option value="bank">Straight to bank</option>
                </select>
              </Field>
              <Field label="Date"><input type="date" name="date" defaultValue={today()} className="input" /></Field>
              <Field label="Note"><input name="notes" className="input" /></Field>
            </div>
            <SubmitButton>Save payment</SubmitButton>
          </ActionForm>
        </Card>
      )}
      <Card title="Purchases">
        <List>
          {(sales ?? []).map((s) => (
            <Row key={s.id} href={`/sales/${s.id}`}>
              <div>
                <div className="font-medium">{qty(s.cartons, s.bottles)} · {s.product_name}</div>
                <div className="text-xs text-gray-500">{fmtDate(s.date)}</div>
              </div>
              <div className="text-right">
                <div className="tabular-nums">{tzs(s.total)}</div>
                {Number(s.balance) > 0 && <Badge tone="amber">owes {tzs(s.balance)}</Badge>}
              </div>
            </Row>
          ))}
        </List>
        {!sales?.length && <p className="text-sm text-gray-500">No purchases yet.</p>}
      </Card>
      <Card title="Payments">
        <List>
          {(payments ?? []).map((p) => (
            <Row key={p.id}>
              <span className="text-sm">{fmtDate(p.date)} · {METHOD_LABEL[p.method]}</span>
              <span className="tabular-nums">{tzs(p.amount)}</span>
            </Row>
          ))}
        </List>
        {!payments?.length && <p className="text-sm text-gray-500">No payments yet.</p>}
      </Card>
      <Card title="Edit details">
        <ActionForm action={saveCustomer} reset={false}>
          <input type="hidden" name="id" value={c.id} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name"><input name="name" defaultValue={c.name} className="input" required /></Field>
            <Field label="Phone"><input name="phone" defaultValue={c.phone} className="input" /></Field>
          </div>
          <Field label="Location"><input name="location" defaultValue={c.location} className="input" /></Field>
          <Field label="Notes"><input name="notes" defaultValue={c.notes} className="input" /></Field>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </Card>
      {can(me, "customers") && !sales?.length && (
        <div className="flex justify-end">
          <InlineAction action={deleteRecord} fields={{ table: "customers", id: c.id, redirect: "/customers" }} label="Delete customer" className="btn-danger" confirm="Delete this customer?" />
        </div>
      )}
      <Link href="/customers" className="block text-center text-sm text-gray-500">All customers</Link>
    </div>
  );
}

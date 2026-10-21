import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, List, PageHeader, Row } from "@/components/ui";
import { InlineAction } from "@/components/forms";
import { deleteRecord } from "@/app/actions";
import { METHOD_LABEL, fmtDate, fmtDateTime, qty, tzs } from "@/lib/format";

export default async function SaleDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("sales");
  const { id } = await params;
  const supabase = await createClient();
  const { data: s } = await supabase.from("v_sales").select("*").eq("id", id).maybeSingle();
  if (!s) notFound();
  const { data: payments } = await supabase
    .from("payments")
    .select("*, receiver:profiles!payments_received_by_fkey(full_name)")
    .eq("sale_id", id)
    .order("date");

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title={`Sale · ${qty(s.cartons, s.bottles)}`} subtitle={`${s.product_name} · ${fmtDate(s.date)}`} />
      <Card>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-gray-500">Customer</dt>
          <dd>{s.customer_id ? <Link className="text-brand-600" href={`/customers/${s.customer_id}`}>{s.customer_name}</Link> : "Walk-in"}</dd>
          <dt className="text-gray-500">Cartons</dt><dd>{s.cartons} × {tzs(s.price_carton)}</dd>
          <dt className="text-gray-500">Bottles</dt><dd>{s.bottles} × {tzs(s.price_bottle)}</dd>
          {Number(s.discount) > 0 && (<><dt className="text-gray-500">Discount</dt><dd>-{tzs(s.discount)}</dd></>)}
          <dt className="text-gray-500">Total</dt><dd className="font-semibold">{tzs(s.total)}</dd>
          <dt className="text-gray-500">Paid</dt><dd>{tzs(s.paid)}</dd>
          <dt className="text-gray-500">Balance</dt>
          <dd>{Number(s.balance) > 0 ? <Badge tone="amber">{tzs(s.balance)}</Badge> : <Badge tone="green">Fully paid</Badge>}</dd>
          <dt className="text-gray-500">Recorded by</dt><dd>{s.created_by_name} · {fmtDateTime(s.created_at)}</dd>
          {s.notes && (<><dt className="text-gray-500">Note</dt><dd>{s.notes}</dd></>)}
        </dl>
        {Number(s.balance) > 0 && s.customer_id && (
          <Link href={`/customers/${s.customer_id}`} className="btn-primary mt-4 w-full">Record a payment</Link>
        )}
      </Card>
      <Card title="Payments">
        <List>
          {(payments ?? []).map((p) => (
            <Row key={p.id}>
              <div>
                <div className="font-medium">{tzs(p.amount)}</div>
                <div className="text-xs text-gray-500">{METHOD_LABEL[p.method]} · received by {p.receiver?.full_name} · {fmtDate(p.date)}</div>
              </div>
            </Row>
          ))}
        </List>
        {!payments?.length && <p className="text-sm text-gray-500">No payment yet.</p>}
      </Card>
      <div className="flex justify-end">
        <InlineAction
          action={deleteRecord}
          fields={{ table: "sales", id: s.id, redirect: "/sales" }}
          label="Delete this sale"
          className="btn-danger"
          confirm="Delete this sale? The stock goes back and its payments are removed. This is recorded in the activity log."
        />
      </div>
    </div>
  );
}

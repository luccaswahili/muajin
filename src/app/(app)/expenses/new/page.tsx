import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ExpenseForm } from "@/components/expense-form";
import { expenseFormOptions } from "@/lib/options";
import { today } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "New expense" };

export default async function NewExpense() {
  await requirePerm("expenses");
  const opts = await expenseFormOptions();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New expense" />
      <ExpenseForm {...opts} date={today()} />
      <Link href="/expenses" className="mt-3 block text-center text-sm text-gray-500">See all expenses</Link>
    </div>
  );
}

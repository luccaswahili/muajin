import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { signOut } from "@/app/actions";

export default async function PendingPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.is_active) redirect("/");
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-700 px-4">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 text-center shadow-xl">
        <h1 className="text-lg font-semibold">Waiting for access</h1>
        <p className="text-sm text-gray-600">
          You are signed in as <b>{me.email}</b>, but the admin has not given this account access yet. Ask Luca to add your
          email in Admin → Members.
        </p>
        <form action={signOut}>
          <button className="btn-secondary w-full">Sign out</button>
        </form>
      </div>
    </div>
  );
}

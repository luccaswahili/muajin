"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function PasswordForm() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const { error } = await createClient().auth.updateUser({ password: pw });
        setBusy(false);
        setMsg(error ? error.message : "Password changed");
        if (!error) setPw("");
      }}
    >
      <input type="password" className="input" placeholder="New password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required />
      <button className="btn-secondary w-full" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </form>
  );
}

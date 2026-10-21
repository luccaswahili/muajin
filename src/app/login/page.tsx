"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const supabase = createClient();
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace("/");
        router.refresh();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/");
          router.refresh();
        } else {
          setInfo("Account created. Check your email to confirm it, then sign in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/more`,
        });
        if (error) throw error;
        setInfo("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-700 px-4 py-10">
      <div className="mb-6 text-center text-white">
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-white/10 text-3xl font-bold text-accent">M</div>
        <h1 className="text-3xl font-bold tracking-widest">MUAJIN</h1>
        <p className="text-sm text-brand-100">Company management</p>
      </div>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset password"}
        </h2>
        {mode === "signup" && (
          <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
        )}
        <input className="input" type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {mode !== "reset" && (
          <input
            className="input"
            type="password"
            placeholder="Password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{info}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </button>
        <div className="flex justify-between pt-1 text-sm">
          {mode !== "signin" ? (
            <button type="button" className="text-brand-600" onClick={() => setMode("signin")}>Back to sign in</button>
          ) : (
            <button type="button" className="text-brand-600" onClick={() => setMode("signup")}>First time? Create account</button>
          )}
          {mode === "signin" && (
            <button type="button" className="text-gray-500" onClick={() => setMode("reset")}>Forgot password?</button>
          )}
        </div>
        {mode === "signup" && (
          <p className="text-xs text-gray-500">Only emails invited by the admin can use the system.</p>
        )}
      </form>
    </div>
  );
}

// Publishable (public) values. Safe to ship to the browser; data is protected by row level security.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ihbfljepgmlkcrmdqluc.supabase.co";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_kbXHaxnS3d6bTxruCB0EiQ_hdVuNgxM";

// Server-side code may reach Supabase on a private address (e.g. http://supabase-kong:8000 when
// self-hosted next to the app). Cookies keep the public URL's name so browser and server share the session.
export const SERVER_SUPABASE_URL = process.env.SUPABASE_INTERNAL_URL || SUPABASE_URL;
export const AUTH_COOKIE_NAME = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

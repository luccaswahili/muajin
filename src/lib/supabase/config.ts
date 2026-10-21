// Publishable (public) values. Safe to ship to the browser; data is protected by row level security.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://ihbfljepgmlkcrmdqluc.supabase.co";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_kbXHaxnS3d6bTxruCB0EiQ_hdVuNgxM";

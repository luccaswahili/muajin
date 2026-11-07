# Moving Muwa Gin to self-hosted Supabase

1. New DB: run `supabase/migrations/0001…0012` in order (schema).
2. Old DB: run `1-export-run-on-OLD-supabase.sql` (read-only) and save the single `dump` cell.
3. New DB: put that text into `2-import-run-on-NEW-supabase.sql` in place of `PASTE_DUMP_JSON_HERE` and run it.
4. App: build with the root `Dockerfile`, passing build args
   `NEXT_PUBLIC_SUPABASE_URL` (new Kong URL, https) and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (new anon key). Port 3000.

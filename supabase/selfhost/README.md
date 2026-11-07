# Moving Muwa Gin to self-hosted Supabase

1. New DB: run `supabase/migrations/0001…0013` in order (schema).
2. Old DB: run `1-export-run-on-OLD-supabase.sql` (read-only) and save the single `dump` cell.
3. New DB: put that text into `2-import-run-on-NEW-supabase.sql` in place of `PASTE_DUMP_JSON_HERE` and run it.
4. App: build with the root `Dockerfile`, passing build args
   `NEXT_PUBLIC_SUPABASE_URL` (new Kong URL, https) and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (new anon key). Port 3000.

The migration files were verified (2026-11-07) to rebuild a schema identical to the live DB
(tables, columns, views, functions, triggers, grants) on a fresh Postgres 16. 0004 and 0013
were adjusted to match how the live DB was actually changed.

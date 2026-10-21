# Muajin

Management system for Muajin gin: sales, customers and debts, production batches, expenses, bank and cash, stock, reports and owner shares.

Built with Next.js (App Router) and Supabase. Mobile first.

## Run locally

```bash
npm install
npm run dev
```

The app connects to the Muajin Supabase project by default (see `.env.example`; the publishable key is public and data is protected by row level security).

## Database

SQL migrations live in `supabase/migrations`. Business rules (stock checks, deposits needing a second person to confirm, permissions) are enforced in Postgres functions, so they hold no matter which screen is used.

## Access

Only invited emails can use the app. The admin invites people in Admin → Members and chooses their role; roles have on/off permissions per area.

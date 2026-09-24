# Supabase local setup

1. Copy `.env.example` to `.env.local` and fill in the project's URL and publishable key from Supabase.
2. Install Docker Desktop, then run `pnpm db:start` to start the local stack and apply migrations.
3. Run `pnpm db:test` to execute the pgTAP policies tests.

For a remote development project, authenticate with `pnpm exec supabase login`, link the development project, and review migrations before using `pnpm exec supabase db push`. Never link this workflow to production while testing.

The app uses only the public URL and publishable key. Do not add secret or service-role keys to `NEXT_PUBLIC_*` variables.

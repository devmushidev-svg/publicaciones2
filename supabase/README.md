# Supabase local setup

1. Copy `.env.example` to `.env.local` and fill in the project's URL and publishable key from Supabase. Set `NEXT_PUBLIC_SITE_URL` to the app's origin.
2. Install Docker Desktop, then run `pnpm db:start` to start the local stack and apply migrations.
3. Run `pnpm db:test` to execute the pgTAP policies tests.

For email-confirmed signup, add `<NEXT_PUBLIC_SITE_URL>/auth/callback` to the Supabase project's allowed redirect URLs. The signup trigger creates the profile and account preferences.

The media library uses the private `publication-media` Storage bucket. Its migration allows JPEG, PNG, WebP, GIF, and MP4 files up to 25 MB. Objects are stored under `<user-id>/<random-id>.<extension>`; authenticated users can only upload, read, or delete objects in their own folder. Apply the checked-in migrations to the intended Supabase project before using uploads.

For a remote development project, authenticate with `pnpm exec supabase login`, link the development project, inspect `pnpm exec supabase migration list`, and compare the remote schema with every local migration before pushing. Use `pnpm exec supabase db push --dry-run` to preview the pending changes first. Never link this workflow to production while testing.

If another tool has already created the tables remotely but did not register the matching migration versions, stop before applying these migrations. Reconcile the remote schema and migration history deliberately; the initial schema migrations are intended for a clean project and are not all idempotent.

The pgTAP suite covers profile and idea RLS, metric ownership, and cross-user publication/media links. The timezone conversion unit tests run separately with `pnpm test:unit`.

## Publication editor migration (20260925000600)

Apply `migrations/20260925000600_publication_editor.sql` only after verifying that `20260925000500_categories_and_tags.sql` is present in the target project. The migration preserves existing `publications.media_ids` links in `publication_media`, then removes the legacy column. It stops without changing the schema if any legacy link refers to a missing asset or an asset owned by another user. Resolve such rows first; do not bypass the preflight or mark the migration applied without running it.

After applying, verify that `media_assets.content_sha256` exists, `publications.media_ids` no longer exists, and authenticated users can execute `save_my_publication`. Run `tests/publication_editor.test.sql` with pgTAP against a disposable database to check atomic saves and cross-account ownership. The application code that calls the RPC must be deployed only after this migration succeeds. Do not run the pgTAP file against production because it creates temporary test users inside a transaction.

The app uses only the public URL and publishable key. Do not add secret or service-role keys to `NEXT_PUBLIC_*` variables.

## Publication history (20260925000700)

Apply `migrations/20260925000700_publication_history.sql` after the publication editor migration. It adds append-only, per-user usage records, snapshots the title, copy, category, tags, and selected media, and grants authenticated users access only to their own history. `record_my_publication_use` records one row per selected platform with an idempotency key shared by the occasion. The dashboard action records a post already published elsewhere; it does not send content to a social network.

The migration also prevents a new transition to `published` without a history row. Run `tests/publication_history.test.sql` only against a disposable Supabase database; it creates test users and content inside a transaction.

## Daily recommendations (20260925000800)

Run `migrations/20260925000800_recommendations.sql` after categories and publication history exist. It stores each account's daily suggestion count and reuse interval, plus enabled state, priority, and optional target share per category. Both tables use owner-only RLS. The migration tolerates a prior partial run; it does not delete saved preferences. The dashboard scorer is deterministic and reads publication history; it does not publish or schedule content. Validate with `pnpm test:unit`; apply database tests only against a disposable Supabase project.

`tests/recommendations.test.sql` checks preference isolation and category ownership with pgTAP. Run it only against a disposable local database.
# Copy generation with AI

Apply `migrations/20260928000100_ai_copy_generation.sql` after the publication editor migration. It creates private per-user generation history, an atomic monthly limit of 30 attempts, and authenticated-only RPCs for reserving and finishing a generation. Apply the SQL in the Supabase SQL Editor, then run `tests/ai_copy_generation.test.sql` locally with `pnpm db:test`.

The app calls the OpenAI Responses API only from a server action. Configure `OPENAI_API_KEY` as a private Vercel environment variable (never `NEXT_PUBLIC_*`); `OPENAI_MODEL` is optional and defaults to `gpt-4.1-mini`. No social network publishing is performed.

## Phase 7 hardening, calendar, campaigns, and ideas (20260928000200 – 20260928000400)

Apply in order, after `20260928000100_ai_copy_generation.sql`:

1. `20260928000200_ai_copy_draft.sql` — `save_my_ai_copy_draft` creates the reviewed draft and links it to the generation in one transaction (retries return the same draft). Reservations accept the six platforms offered by the UI and close attempts left in `generating` for more than 10 minutes.
2. `20260928000300_schedule_and_campaigns.sql` — `campaigns` and `scheduled_posts` (read-only to owners; writes through `schedule_my_publication`, `reschedule_my_post`, `cancel_my_scheduled_post`, `record_my_scheduled_post_use`, `save_my_campaign`, `set_my_campaign_archived`). Existing `publications.status = 'scheduled'` rows become planned slots and the publications return to `draft`. `save_my_publication` stops accepting `scheduled`; deploy the matching app code right after applying it.
3. `20260928000400_ideas_opportunities.sql` — ideas gain `campaign_id`, `publication_id` and `source_key`; `convert_my_idea_to_draft` and `save_my_opportunity_idea` are atomic and idempotent.

A scheduled post is an intention. Only `publication_history` records real use, and a slot becomes `fulfilled` only through `record_my_scheduled_post_use`. Campaign dates and the one-slot-per-day rule use the account timezone from `account_preferences`.

Before applying to the remote project, run `verify_remote_state.sql` in the SQL Editor. It is read-only and reports, per migration, whether its objects exist and whether its version is registered in `supabase_migrations.schema_migrations`. Do not insert versions by hand to make them match.

## Tests

- `pnpm db:test` runs every pgTAP file in `tests/` against the local stack.
- `pnpm test:integration` signs up real users against the local Auth + PostgREST and checks phases 5–9 end to end (users A and B, anonymous, retries, duplicates, time zones). It needs `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from `supabase status` and must never point at production.

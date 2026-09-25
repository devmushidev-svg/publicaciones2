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

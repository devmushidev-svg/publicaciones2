# Supabase local setup

1. Copy `.env.example` to `.env.local` and fill in the project's URL and publishable key from Supabase. Set `NEXT_PUBLIC_SITE_URL` to the app's origin.
2. Install Docker Desktop, then run `pnpm db:start` to start the local stack and apply migrations.
3. Run `pnpm db:test` to execute the pgTAP policies tests.

For email-confirmed signup, add `<NEXT_PUBLIC_SITE_URL>/auth/callback` to the Supabase project's allowed redirect URLs. The signup trigger creates the profile and account preferences.

The media library uses the private `publication-media` Storage bucket. Its migration allows JPEG, PNG, WebP, GIF, and MP4 files up to 25 MB. Objects are stored under `<user-id>/<random-id>.<extension>`; authenticated users can only upload, read, or delete objects in their own folder. Apply the checked-in migrations to the intended Supabase project before using uploads.

For a remote development project, authenticate with `pnpm exec supabase login`, link the development project, and review migrations before using `pnpm exec supabase db push`. Never link this workflow to production while testing.

The app uses only the public URL and publishable key. Do not add secret or service-role keys to `NEXT_PUBLIC_*` variables.

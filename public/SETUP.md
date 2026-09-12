# FLIGHT DECK — GitHub Pages and Supabase setup

## 1. Enable hosting

In `Turkson225/FLIGHT-DECK`, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. The included `Deploy FLIGHT DECK` workflow runs on `main` pushes or manual dispatch. A successful deployment returns the site URL. The anticipated project URL is `https://turkson225.github.io/FLIGHT-DECK/`; it is not live until Pages reports a successful deployment.

The repository and Pages shell are public. Protected telemetry and recordings remain in Supabase and require membership. Never commit actual telemetry exports, email codes or secret keys to the public repository.

## 2. Connect a Supabase project

Create or select your own Supabase project. This step is not performed by the application. In GitHub **Settings → Secrets and variables → Actions → Variables**, set:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your project's HTTPS URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your `sb_publishable_...` key (or legacy anon key) |
| `VITE_WORKSPACE_ID` | Optional shared workspace UUID; omit for personal workspaces |

Only the publishable/anon key belongs in browser configuration. Never use a service_role key, `sb_secret_...`, database password, SMTP password or device token in a `VITE_` value. Changes require another Pages build.

## 3. Create protected data and deploy the backend

For setup entirely in your browser, use the [Supabase dashboard deployment guide](https://github.com/Turkson225/FLIGHT-DECK/blob/main/supabase/dashboard/README.md). It includes one complete file per function and preserves the same authentication checks.

Install the Supabase CLI from its official instructions. Authenticate locally, then:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
node scripts/sync-contracts.mjs
supabase secrets set ALLOWED_ORIGINS=https://turkson225.github.io
supabase functions deploy flight-api
supabase functions deploy telemetry-ingest
```

Alternatively run `supabase/migrations/202609120001_flight_deck.sql` in the project's SQL Editor once, then deploy both function folders. This creates `fd_members`, `fd_records`, `fd_telemetry`, a private `flight-recordings` bucket, RLS, a new-user personal-workspace trigger and an atomic ingest function. Applied migrations should not be rewritten.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are Edge Function runtime values provided by Supabase. They never belong in Pages variables. `ALLOWED_ORIGINS` is a comma-separated list of frontend origins, without a URL path; add your local development origin only for testing.

The functions intentionally perform authentication themselves (`verify_jwt=false` in config). **This does not make data public:** `flight-api` calls `auth.getUser`, requires confirmed email, checks workspace membership and checks the server-side role before writes. Direct browser writes to the database are revoked; RLS scopes reads. Ingress has a separate device credential. Never deploy a version that removes these checks.

## 4. Email verification code, like the reference

Under Supabase **Authentication → Sign In / Providers → Email**, enable email login and account creation, keep email confirmation enabled, and set **Email OTP expiration to 1800 seconds (30 minutes)**. The included email text assumes this setting.

Under **Authentication → Email Templates**, replace the **Magic Link** body with `supabase/templates/verification.html`; use subject **FLIGHT DECK login verification code**. The `{{ .Token }}` variable sends a code instead of a magic link. Use the same branded template for Confirm signup if your project's signup flow uses it. Do not hard-code a code or copy the sender identity from the reference image.

Set Site URL and permitted redirect URL to `https://turkson225.github.io/FLIGHT-DECK/`. The current app verifies the code on the same screen and does not rely on a magic-link callback.

Configure your own **custom SMTP sender** in Supabase. Its default sender restricts recipients and is intended for initial testing. Set a verified sender address/domain you own, with the provider's SPF/DKIM settings. SMTP credentials stay in Supabase. Configure rate limits; the UI adds a resend cooldown, but the server remains authoritative. If you enable Supabase CAPTCHA protection, add that provider's token widget before accepting production signups (not implemented here).

Test with an email address you control: Create account → receive six-digit code → verify → enter workspace. Test incorrect, expired and reused codes, resend throttling and sign-out. A public repository build cannot configure your sender or verify delivery without this project setup.

## 5. Roles

Each newly registered user owns a separate personal workspace, with no access to your aircraft. The owner may assign Operator or Viewer in **Profiles & settings → Access & storage**, using the other user's verified Supabase UUID. Share a link with `?workspace=OWNER_WORKSPACE_UUID`. Operators can save configuration and records; Viewers cannot write. Creating an account alone never grants access to another owner's workspace.

## 6. Hardware telemetry (optional; keep demo available)

Set server-only secrets through the Supabase dashboard:

- `DEVICE_ID`: the provisioned aircraft ID, initially `FD-001`.
- `DEVICE_WORKSPACE_ID`: owner's workspace UUID.
- `DEVICE_SHARED_TOKEN`: a newly generated high-entropy token, minimum 32 characters.

Provision that device token in the aircraft telemetry client or trusted gateway. POST the versioned envelope to `/functions/v1/telemetry-ingest` with `x-device-token`. Do not put it in GitHub or browser variables. See `public/INTEGRATION.md` for formats, rates, electrical notes and limitations.

## 7. Modes and startup behavior

Use **Flight modes & startup** to configure angles. All presets initially use zero degrees; measure and validate airframe settings rather than assuming generic takeoff or landing values. The five-second startup preview requires the Stationary scenario and simulated local authorization. Live execution remains unsupported until installed Nano firmware reports and enforces it. The browser does not schedule real movements over the internet.

## 8. Verify before relying on protected data

- Confirm anonymous requests cannot read saved data, Viewer writes are rejected, and user B cannot access user A's workspace.
- Confirm settings, profiles, event history and stopped recordings reload after sign-out/sign-in.
- Confirm LIVE stays Unknown without authenticated device telemetry; disable connectivity and verify Stale status.
- Confirm the browser bundle contains only the intended public project URL/key and no device/backend secrets.
- Confirm DEMO/REPLAY cannot send actuator commands. This release has no live dispatcher.

Official references: [Supabase email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Edge Function authentication](https://supabase.com/docs/guides/functions/auth), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Recovery and voice update

Refresh the deployed site and open **Recovery & voice**. The guarded simulator and browser voice controls need no additional service. Click **Enable voice**, then **Test voice** on the operator device; resume audio after reloading.

For the new safety telemetry and saved parachute simulation audits, redeploy both existing Edge Functions from the latest generated files as described in [the dashboard deployment guide](https://github.com/Turkson225/FLIGHT-DECK/blob/main/supabase/dashboard/README.md#updating-for-recovery-and-voice). No new SQL migration or SMTP configuration is required. Live parachute control remains disabled pending a separate onboard implementation and validation.

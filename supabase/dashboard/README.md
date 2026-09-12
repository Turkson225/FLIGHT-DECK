# Deploy FLIGHT DECK from the Supabase dashboard

These generated files contain the canonical functions and their shared validation code in one file per function. Their only imports are pinned npm dependencies resolved by Supabase. This is a deployment option for the existing backend; it does not create another database or change the website login.

## 1. Set the allowed website origin

In your Flight Deck project, open **Edge Functions → Secrets**. Add:

| Name | Value |
|---|---|
| `ALLOWED_ORIGINS` | `https://turkson225.github.io` |

Use the origin only, without `/FLIGHT-DECK/`. Supabase provides the function runtime's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; never copy those secrets into the website or this repository.

## 2. Deploy the workspace API

1. Open **Edge Functions → Deploy a new function → Via Editor**.
2. Set the function name to **`flight-api`**.
3. Open [flight-api.ts](flight-api.ts), click **Raw**, and copy its entire contents.
4. Replace the editor's `index.ts` contents with that code.
5. Deploy the function.
6. In that function's configuration, turn **Verify JWT** / **Verify JWT with legacy secret** **off** and save. This matches `verify_jwt = false` in the repository's function configuration. If the setting is presented before deployment, set it there.

This particular function performs authentication itself: it validates the user session with `auth.getUser`, requires confirmed email, and checks workspace membership and role before data access. Turning off the platform JWT check does not remove these checks. Keep the full provided code, and keep email confirmation enabled in Authentication settings.

## 3. Test saved dashboard access

Return to FLIGHT DECK, refresh, and sign in. Your verified personal workspace should show its database-confirmed role. Save a setting, refresh, and confirm it reloads.

If the browser reports a connection problem, check the function's logs and `ALLOWED_ORIGINS`. An anonymous direct request is expected to be rejected. No live aircraft telemetry is expected until the aircraft client is integrated.

## 4. Deploy the telemetry receiver

Repeat the same editor steps with function name **`telemetry-ingest`**, using the entire [telemetry-ingest.ts](telemetry-ingest.ts) file. Set **Verify JWT** **off** for this function too: it authenticates with a separate device token instead of a browser session.

Until a device credential is provisioned, this endpoint deliberately rejects all telemetry. When you are ready to integrate the aircraft, add these server-only secrets:

| Name | Value |
|---|---|
| `DEVICE_ID` | `FD-001`, matching the aircraft firmware |
| `DEVICE_WORKSPACE_ID` | The owner workspace UUID returned by the owner setup query |
| `DEVICE_SHARED_TOKEN` | A new cryptographically random token, minimum 32 characters |

Provision the same token in the aircraft client or trusted gateway. Keep it out of GitHub and browser configuration. See [the hardware integration guide](../../public/INTEGRATION.md) for the telemetry contract. Browser login and saved settings do not require a device token.

## Updating for recovery and voice

Replace the editor contents of both existing functions with the latest generated `flight-api.ts` and `telemetry-ingest.ts`, then deploy each. Keep their existing secrets and documented authentication configuration. No database migration, SMTP change, or new API key is needed for this update. This allows the optional safety report and new parachute simulator audit to survive validation when telemetry and recordings are saved. Older deployed validators can strip the new fields or reject a recording containing its new audit kind.

GitHub Pages deploys the frontend only; pushing this repository does **not** redeploy Supabase functions. Voice settings and simulator controls work immediately in the browser. Real safety reports require these function updates plus onboard firmware. Live actuator dispatch remains disabled after updating.

## Updating for NodeMCU live telemetry

Redeploy both bundles for optional `sampledAt` timestamps and PWM-only output fields (`normalized:null`, `saturated:null`). The ingestion function rejects capture timestamps older than 2 seconds or more than 5 seconds ahead; the browser uses capture age when deciding freshness. No SQL migration is required. Set the three device secrets above and install the [combined NodeMCU client](../../firmware/FlightDeck_Node_Live/README.md). GitHub Pages does not redeploy these functions.

## Maintaining these files

Edit the canonical code under `supabase/functions` and `lib`, then run:

```bash
pnpm functions:bundle
pnpm test:functions
```

Commit the regenerated files together with the source changes. CI checks that the generated files match the source and executes authentication/interlock checks against the bundles using a mocked database boundary. These tests do not replace testing the deployed project, SMTP, RLS, or aircraft firmware. Live actuator dispatch remains disabled.

Official references: [Dashboard deployment](https://supabase.com/docs/guides/functions/quickstart-dashboard), [function secrets](https://supabase.com/docs/guides/functions/secrets).

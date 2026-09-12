# FLIGHT DECK

A React + TypeScript fixed-wing engineering console, hosted as a static GitHub Pages app with Supabase email-code authentication and protected backend data.

**Start here: [SETUP.md](./SETUP.md).** The login form displays an honest setup state until a Supabase URL and publishable key are configured. The interactive DEMO needs no account. Do not paste service keys, device tokens, SMTP passwords or email verification codes into chat or GitHub source.

## Included

- Charcoal/orange/lime design with a light theme, responsive workspace navigation, accessible controls and reduced-motion support.
- Overview, live monitor, controller/mixer, IMU, batteries, links, sessions/replay, event history, preflight, bench tools, profiles/settings and capability-gated future navigation.
- Account creation/sign-in via emailed six-digit OTP, code verification, resend cooldown, sign-out and session renewal. Supabase validates codes; the app does not generate or verify codes locally.
- Supabase Postgres membership and protected records, private Storage recordings and Edge Functions with authenticated Owner/Operator/Viewer enforcement.
- Cruise/Takeoff/Smooth landing **surface presets**: configurable angles, travel references, smoothstep transitions, bounded angular rate and per-servo PWM limits. These are not automatic flight controllers.
- Startup visual inspection simulator: five seconds after simulated power-up, four-surface sweep, neutral return, explicit maintenance gates, abort and ESC exclusion.
- Nonblocking C++ startup reference, with no pin writes, plus radio/UART contracts and the original wiring references.
- GitHub Actions build/test/deployment workflow. Existing Sites data is not automatically migrated.

## Local development

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
pnpm test
pnpm build
```

The static output is `dist/`. `BASE_PATH=/FLIGHT-DECK/ pnpm build` creates project-site URLs. Navigation uses hash routes so GitHub Pages requires no server rewrites.

After changing contracts, run `node scripts/sync-contracts.mjs` and `node scripts/export-contracts.mjs`, then redeploy the Edge Functions. Synced files under `supabase/functions/_shared` are committed for reproducible deployment.

## Implementation limits

The UI, simulator, recording/export/replay, mode configuration and authentication client are implemented. Actual email delivery requires Supabase/SMTP setup. No live motor or servo command dispatcher is included. A successful UI preview or smooth servo trajectory does not demonstrate a stable aircraft or safe landing. All actual control, stabilization, mode selection, loss-of-radio behavior and watchdogs belong onboard. No GPS track is fabricated from the MPU6050; the supplied map reference informs layout only.

The startup header is a reference state machine, not a receiver sketch. Physical local authorization, trustworthy disarm/throttle/radio signals, PWM mapping, measured travel, sensor conversion and aircraft tests are still required. No firmware is automatically installed from the browser.

Sessions capture only browser-received samples, up to 18,000 per recording. Recordings are saved when stopped. Guest work is temporary and exportable. Signed-in settings, profiles, event snapshots and recordings use Supabase, with no automatic retention purge. Mode preview movements are separate from the main telemetry stream: configuration and preview events can be recorded, but preview degrees are not presented as aircraft measurements.

## Validation

38 automated TypeScript-model tests pass: missing telemetry, mixing/limits, command guards, export fidelity, event contracts, gradual transitions and startup timing/interlocks. A host-compiled C++ check covers startup delay, sweep, skip and pilot override. The static production build passes. Supabase migration/RLS/function deployment, actual email delivery and end-to-end signed-in persistence require a configured project and are not yet verified. No hardware-in-loop or mobile-device validation is claimed.

See [hardware and telemetry integration](./public/INTEGRATION.md).

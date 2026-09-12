# FLIGHT DECK — integration guide, contract v1

This release implements an engineering dashboard and telemetry gateway boundary. It does **not** include aircraft control firmware, a validated autopilot or a live actuator transport. All live command requests are rejected and audited. Do not infer flight readiness from a successful demo.

## Combined NodeMCU monitoring client

[Connect the NodeMCU](./NODEMCU_SETUP.html) using the included [firmware](./NODEMCU_README.md). It reads the MPU6050, calibrated voltage and the existing Nano v1 binary UART at 38400 baud. It sends HTTPS telemetry through the MiFi to Supabase, with no browser command receiver. Existing Nano sketches stay in place. The full setup guide documents credentials, upload, mounting, ADC validation and local diagnostics.

The optional `sampledAt` field is UTC capture time. Ingestion replaces `receivedAt` with server time and rejects captures older than 2 seconds or more than 5 seconds ahead. Display freshness uses the older capture/receive time. This is freshness checking, not measured one-way latency. A PWM-only output uses `normalized:null` and `saturated:null`; the browser shows microseconds without inventing surface angles. Update both deployed function bundles before connecting this firmware.

## Responsibilities

- Transmitter Nano samples four joystick axes, two potentiometers, throttle slider, four buttons and its battery. It sends compact radio packets and drives its own buzzer.
- Aircraft Nano receives nRF24 commands and independently produces servo/ESC outputs. Local packet-age checks, loss-of-radio behavior, output bounds and watchdogs belong here.
- NodeMCU receives Nano status over level-shifted UART, samples MPU6050 and battery voltage, and makes an outbound authenticated telemetry connection through MiFi.
- Gateway validates device authentication and forwards the versioned envelope to the web backend. The dashboard, charts and database run on the host, not the ESP8266.

Browser, Wi-Fi, MiFi and cloud loss must never prevent the physical transmitter from controlling the aircraft. Stabilization is a separate firmware capability; it is not implemented here.

## GitHub Pages + Supabase integration

See [SETUP.md](./SETUP.md) first. GitHub Pages serves static assets. Supabase hosts verified-email authentication, protected Postgres records, private recordings and Edge Functions. The browser never receives the service role key or device credential.

The NodeMCU (or a telemetry-only gateway if TLS/memory measurements require one) makes an outbound HTTPS POST to `https://YOUR_PROJECT.supabase.co/functions/v1/telemetry-ingest` with `x-device-token: YOUR_DEVICE_SHARED_TOKEN` and a JSON `{frame, capabilities}` envelope. Provision a random credential of at least 32 characters in both the aircraft client and Edge Function secrets. Do not publish it or put it in any VITE_ variable. TLS certificate validation is required.

The ingress is bound to one configured workspace/device. It validates LIVE source, device ID, capabilities and matching boot ID, sanitizes unsupported/invalid telemetry, and records server receive time. Atomic Postgres ingestion rejects same-boot duplicate/out-of-order sequences and updates closer than 80 ms. Start at 5 Hz and measure actual sustained performance before raising the rate. Browser polling is initially capped at 5 Hz. Device time and server time do not measure one-way latency.

This credential is not a replay-proof protocol across different boots: secure device boot identifiers, token storage and rotation still require firmware design. Never expose the ingress token to a browser. Browser sessions authenticate separately and cannot write telemetry.

The `flight-api` function validates the JWT and confirmed email, reads workspace membership, and rejects Viewer writes. All command requests are audited as Rejected, `sent:false`. No live actuator dispatch, queue, retained message, reconnection retry or accepted/applied acknowledgment is implemented.

## Local-network testing

Run `pnpm dev` on a computer for the credential-free simulator. Supabase CLI can host the database/functions locally for integration testing; add that frontend origin to ALLOWED_ORIGINS. A trusted local HTTPS gateway may forward telemetry to the configured Supabase ingress. A MiFi private IP is never assumed to be reachable from the internet. The aircraft still connects outbound. Keep Nano control loops independent of TLS and networking.

## Surface presets and startup inspection

Cruise, Takeoff and Smooth landing are requested **surface presets**, not automatic flight phases or navigation. “Takeoff position” here means a surface angle relative to neutral, not a geographic position. Profiles start at zero degrees because airframe-specific angles were not supplied. Configure measured travel before applying a nonzero offset. The preview uses a symmetric degree-to-PWM estimate, per-servo reversal/trim/PWM limits, and smoothstep transitions with a bounded peak angular rate. This does not validate aerodynamics, stability, flare timing or a safe landing.

Future Nano firmware must select the mode locally via the physical transmitter, apply offsets without removing pilot authority, bound mixed outputs, reject unsafe in-flight transitions, and report requested versus applied mode/configuration version. No extra physical buttons or unmapped pins are invented here.

Startup preview requires the Stationary scenario and explicit simulated maintenance authorization. It waits five seconds, sweeps four surfaces over eight seconds, then returns to neutral. The ESC is excluded. `integration/startup_inspection.h` is a nonblocking reference state machine with no pin writes. It checks configured/disarmed/throttle-low/stationary/local-authorized/fresh-radio gates, skips a missed startup window, aborts on pilot override or loop stalls, and never restarts after failure until a new MCU boot. Integrate and test it on the Nano; creating a dashboard setting does not install firmware. Local authorization must originate on the aircraft. Power cycling with unknown arm state must not trigger movement.

## Parachute recovery and safety reports

The persistent **Parachute** button opens a protective cover and confirmation dialog. In DEMO it applies a one-shot simulated deployment and creates an event with command ID, aircraft ID, issuer, parameters, creation/expiry times, `sent:false`, and `Applied (simulator)` status. Reset is explicit. Switching environment/aircraft resets the simulator guard. No live endpoint is called by this workflow. REPLAY cannot activate it. The visualization reports status only; it does not simulate canopy dynamics, descent, motor shutdown, or a safe recovery.

LIVE parachute dispatch remains **disabled on the server and in the UI**, even for Owner and even if firmware advertises support. The command contract reserves `parachute.deploy`; direct requests are rejected and audited, including expired requests. The generic bench gate explicitly rejects this command. There is no dispatch queue or reconnect resend.

Hardware and firmware work is still required: a suitable recovery mechanism and electrical interface; an independently usable transmitter action; aircraft-specific deployment conditions and pilot authority; deliberate activation protection; a single-use deployment latch; independent power/fault handling; local duplicate/expiration checks; and deployment feedback where available. Define and test this on the airframe before enabling any live transport. No output pin, release angle, failure threshold, or automatic deployment rule is supplied or enabled by this website. In particular, D7 is not assigned to a parachute.

Safety telemetry is an optional, additive extension to the v1 frame:

```json
{
  "validity": { "safety": "valid" },
  "safety": {
    "schemaVersion": 1,
    "flightFailure": null,
    "failureReason": null,
    "readyForTakeoff": null,
    "parachute": {
      "installed": true,
      "ready": false,
      "state": "stowed",
      "feedback": "none"
    }
  }
}
```

This is a fragment, not a complete ingestion payload. Keep the usual frame/device/boot/sequence/uptime/source envelope. Supported capability feature names are `flightFailureDetection`, `takeoffReadiness`, `parachute`, and `parachuteFeedback`. Report only capabilities the installed implementation actually supplies; omit the safety extension or use null when unavailable. The simulator advertises these features only for simulated data.

Safety values require matching device and boot IDs, `validity.safety = valid`, and healthy Nano UART. Source sensors must be fresh before the device marks the snapshot valid. After two seconds without a fresh frame the browser labels the report stale and cannot treat it as current readiness. Unsupported failure/readiness fields become null at ingestion. `parachute.state` is `unknown`, `stowed`, `released`, `deployed`, or `fault`; `feedback` is `none`, `release_sensor`, or `deployment_sensor`. A `deployed` claim without the feedback capability and deployment sensor is sanitized to `unknown`. `released` does not confirm that the parachute opened. A motor/servo acknowledgment never proves physical deployment.

Fresh failure reports create a critical visual event. Merely losing radio, UART, browser or internet connectivity does not establish that the aircraft failed. The browser cannot guarantee delivery of an emergency request, especially during the link failure it is warning about. Local RC control, release logic and failsafes must function without the browser or MiFi.

Existing recordings remain readable. New JSON recordings preserve the safety extension and guarded DEMO audit. CSV adds `flight_failure_reported`, `parachute_state`, and `parachute_feedback`, leaving missing fields empty. DEMO replay can display its simulated recovery state; old LIVE recordings without accompanying firmware capabilities cannot establish current recovery support.

## Browser voice announcements

Open **Recovery & voice → Enable voice**. Select a system voice, volume, speaking rate and categories; **Test voice** and phrase previews exercise browser speech. **Mute voice** cancels current/queued announcements. **Stop speaking** clears speech now but leaves future alerts enabled. Preferences are saved per browser in `flightdeck-voice-v1`, independently of workspace settings and the transmitter buzzer. A fresh page requires a user gesture to resume audio. No microphone permission is needed. Installed voices and audible playback depend on the browser/OS; some system voices may use their own online service. See [MDN SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis).

Announcements cover link loss/restoration, aircraft/transmitter low or critical voltage, IMU loss/restoration, an explicit reported flight failure, preflight readiness, parachute release/deployment/fault, session recording, and rejected commands. Text is selected from fixed application phrases; arbitrary firmware messages are not spoken.

- Every automatic DEMO phrase starts with “Demo.” Explicit preview phrases start with “Voice preview.” Automatic replay speech is disabled.
- Lost telemetry means “Aircraft telemetry connection lost. Aircraft condition unknown.” Initial offline waiting does not fabricate a previously connected aircraft.
- “Flight failure reported” requires a fresh, valid report and explicit firmware capability. Link loss and MPU6050 attitude alone cannot generate it.
- Completed operator checks without the full readiness gates say “Operator checklist complete. Aircraft readiness not confirmed.”
- “Preflight complete. Ready for takeoff” requires explicit supported firmware readiness and no reported failure, all six operator checks, fresh telemetry, healthy radio/UART/Wi-Fi/uplink and IMU, low throttle, a known disarmed state, and both batteries above warning thresholds. An installed reported parachute must be stowed and ready. This phrase conveys the configured checks; it is not independent certification of airworthiness.
- Alerts are edge-triggered with a 15-second per-message repeat limit. Critical notices interrupt routine speech. The waiting queue is bounded to four items; stale (over eight seconds), resolved and environment-mismatched notices are discarded. Scope changes and muting cancel queued speech.

To try readiness: select **Stationary aircraft**, enable voice, then complete the six operator checks on Preflight. To try a failure: select **Reported flight failure**. Radio/UART/Internet/IMU and Battery scenarios exercise the other messages. A browser with no working speech engine shows a visible error and retains announcement captions/history; test audible delivery on the actual operator device. Closed, sleeping or suspended browsers cannot provide dependable alerts. Voice is supplementary to visible warnings and onboard protection.

## Compact radio proposal

`integration/radio_packet.h` documents a 24-byte little-endian packet: version and flags; 16-bit sequence/boot; four signed joystick axes; unsigned throttle; two signed pots; transmitter millivolts; button bitmap and reserved byte. Signed controls use −1000…1000; throttle uses 0…1000; unavailable voltage uses 0xffff. nRF24's hardware CRC is not authentication. Pairing, address, RF channel/data rate, power, interference handling and radio security are separate firmware design work. Never send web JSON over nRF24.

Mix ON/OFF are latched. Neither pressed retains the state; both pressed ignores the conflict and retains the last confirmed state. Auxiliary IN/OUT is momentary: neither or both means STOP. Hardware timeout must stop auxiliary motion when command refresh is lost. Do not drive the proposed D7 output until its electrical interface and role are explicitly mapped.

## UART proposal

Separate UART framing from radio framing: `0xA5 0x5A`, version u8, type u8, payloadLength u16, sequence u16, boot u32, uptime u32, payload (maximum 96 bytes), CRC16-CCITT-FALSE. All multibyte values little-endian. Types: 1 controller inputs, 2 applied output commands, 3 Nano health, 4 capability/configuration acknowledgment. CRC covers version through payload. Reject excessive length, bad CRC, stale/duplicate sequence and unknown versions. Resynchronize on the two-byte prefix; expire incomplete frames after an explicit firmware timeout. Validate an initial 115200 baud setting with the chosen level shifter and USB interfaces. This is a proposed contract, not installed firmware.

Applied output fields contain commanded microseconds and normalized commands, not measured servo positions. Carry a validity bitmap plus radio receive/expected/retry counters, last valid packet age, throttle-low/arm state only when firmware implements them, and applied configuration version. Command and sample rates are independent.

## Sensor semantics

Acceleration is raw specific force in m/s², including the gravity effect; the UI can display g by dividing by 9.80665. Gyro is deg/s. Pitch and roll are estimator outputs, not direct MPU6050 registers. Relative yaw is shown only when reported and drifts. Chip temperature is not ambient air temperature. Compensated linear acceleration requires an explicit capability and a supplied estimate. GPS, compass heading, airspeed, ground speed, altitude and distance remain absent without appropriate sensors and estimators.

Use `null` plus validity status for unavailable readings. `Unknown` means not reported; `Not installed` means known absent hardware; `Unsupported` means absent firmware capability; `Stale` means a previously received sample exceeded its age limit. The console marks samples stale after two seconds. Do not substitute zero. Each frame represents one synchronized telemetry snapshot; individual sensor ages must be handled by firmware and validity flags before publishing.

References: [Adafruit MPU6050](https://learn.adafruit.com/mpu6050-6-dof-accelerometer-and-gyro/overview), [RF24 API](https://nrf24.github.io/RF24/classRF24.html), [ESP8266 BearSSL](https://arduino-esp8266.readthedocs.io/en/latest/esp8266wifi/bearssl-client-secure-class.html). TLS has significant memory and execution costs on ESP8266; hardware timing must remain independent.

## Wiring reference

| Board | Pins | Purpose |
|---|---|---|
| Transmitter Nano | A0/A1 | Joystick 1 rudder/elevator |
| Transmitter Nano | A2/A3 | Joystick 2 left/roll, right/common |
| Transmitter Nano | A4/A5 | Potentiometers 1/2 |
| Transmitter Nano | A6/A7 | Throttle slider / transmitter voltage sensor |
| Transmitter Nano | D2/D3 | Mix ON/OFF |
| Transmitter Nano | D4/D5 | Auxiliary IN/OUT |
| Transmitter Nano | D7 | Buzzer |
| Both Nanos | D9/D10 | nRF CE/CSN |
| Both Nanos | D11/D12/D13 | MOSI/MISO/SCK |
| Aircraft Nano | D2/D3/D4/D5 | Left aileron/right aileron/elevator/rudder |
| Aircraft Nano | D6 | ESC |
| Aircraft Nano | D7 | Proposed auxiliary, not mapped automatically |
| Aircraft Nano | D0/D1 | UART RX/TX through level shifter |
| NodeMCU | D1/GPIO5, D2/GPIO4 | MPU6050 SCL, SDA |
| NodeMCU | A0 | Aircraft voltage sensor output |
| NodeMCU | RX/GPIO3, TX/GPIO1 | Nano UART through level shifter |

Validate USB/UART sharing and avoid two drivers driving the same RX/TX line. Cross TX to RX. Verify common ground and level-shifter suitability. Check the exact NodeMCU board's A0 limits and divider before connecting the voltage sensor; never apply battery voltage directly. Use sufficient regulated 3.3 V power and decoupling for the PA/LNA radio. The table is documentation, not permission to drive outputs.

## Firmware work still required

Actual transmitter/radio/UART sketches; receiver output generation; calibrated voltage conversion; attitude estimator and sensor mounting transformation; supported capability reports; local maintenance and watchdog implementation; tested aircraft-specific radio-loss behavior; verified motor isolation; local command expiration and duplicate rejection; secure provisioning and credential rotation; sustained throughput and electrical validation. Autonomous navigation, return-to-home, geofencing, stabilization and flight-time detection are not implemented.

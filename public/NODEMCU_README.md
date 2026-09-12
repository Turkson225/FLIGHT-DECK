# FLIGHT DECK NodeMCU live telemetry

Upload this sketch to the **NodeMCU ESP8266 only**. It replaces the earlier Wi-Fi-off battery bridge and works with the existing FlightDeck Nano firmware v1 at **38400 baud, 8N1**. Keep the transmitter and receiver sketches already uploaded.

This is a monitoring client, not a flight controller. It does not accept browser commands, write servo/ESC pins, deploy a parachute or stabilize an aircraft. Physical radio control and link-loss handling stay on the receiver Nano.

## 1. Prepare Supabase

Open your project's **Edge Functions**. Update both existing functions, `flight-api` and `telemetry-ingest`, with the latest complete generated files in `supabase/dashboard/` in the FLIGHT-DECK GitHub repository. Replace each editor's `index.ts` and deploy. Keep platform **Verify JWT off** for these particular functions: the provided code validates browser sessions or device tokens itself. Do not remove that validation. No SQL migration is required for this update.

In **Edge Functions → Secrets**, set:

| Name | Value |
| --- | --- |
| `DEVICE_ID` | `FD-001` |
| `DEVICE_WORKSPACE_ID` | Your owner workspace UUID, shown in dashboard Settings → Account & permissions |
| `DEVICE_SHARED_TOKEN` | A new cryptographically random token of at least 32 characters; use the setup page generator or `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | `https://turkson225.github.io` |

If a device token is already provisioned, reuse that same token; changing it disconnects clients using the previous token. These settings bind this endpoint to one aircraft and workspace. Use a dedicated device registry before expanding to a fleet.

The aircraft token is separate from the Supabase publishable key, service-role key and your email login. Only the aircraft and ingestion function need the aircraft token. Never commit `Secrets.h`, tokens or compiled firmware containing credentials. GitHub Pages deployment does not deploy these Supabase functions.

## 2. Set up Arduino IDE

1. In Preferences → Additional Boards Manager URLs, add `https://arduino.esp8266.com/stable/package_esp8266com_index.json`.
2. Install **esp8266 by ESP8266 Community, 3.1.2** in Boards Manager.
3. Install **ArduinoJson by Benoit Blanchon, 6.21.5** in Library Manager. This sketch targets major version 6.
4. Extract the ZIP. Open `FlightDeck_Node_Live/FlightDeck_Node_Live.ino` with its companion files in the same folder.
5. Copy `Secrets.example.h` to **`Secrets.h`**. Enter your MiFi Wi-Fi name/password and the identical `DEVICE_SHARED_TOKEN` value. Use a 2.4 GHz WPA2-compatible Wi-Fi network with internet access. Do not paste these values into chat.
6. Select **NodeMCU 1.0 (ESP-12E Module)**, **CPU Frequency 160 MHz**, and the board's USB port. The upload speed is separate from the 38400-baud Nano link.
7. With the propeller removed and actuator power isolated for setup, disconnect the Nano-to-Node UART wires while uploading. Upload to the NodeMCU; then reconnect crossed UART after disconnecting upload power. USB adapters and this binary UART share pins.

Public project host and `FD-001` are already in `Config.h`. Change the host and device ID there only if your project or aircraft ID differs, and update matching backend/dashboard settings.

## 3. Wiring

| NodeMCU | Connect to |
| --- | --- |
| D1 / GPIO5 | MPU6050 SCL |
| D2 / GPIO4 | MPU6050 SDA |
| 3V3, GND | MPU module compatible 3.3 V supply, common ground; ensure SDA/SCL pull-ups are to 3.3 V |
| RX / GPIO3 | Nano D1/TX through the 5 V → 3.3 V level-shifter channel |
| TX / GPIO1 | Nano D0/RX through the 3.3 V → 5 V level-shifter channel |
| A0 | Safely scaled aircraft battery sensor output, after verifying the actual board ADC limit |

The level shifter uses LV=3.3 V, HV=5 V and a shared ground. Validate its UART waveform at 38400 baud. ESP8266 startup UART bytes are rejected by the Nano packet framing/CRC; do not add text logging to either live UART. Use the local diagnostics page instead.

Do not connect the 12 V pack directly to A0 or the NodeMCU supply. The bare ESP8266 ADC accepts 0–1 V; NodeMCU boards may include a divider, and clone limits differ. A common 5:1 voltage module can still exceed the ADC range of a board without that divider. Check the schematic and measure the divider output at the pack's maximum charged voltage before connecting. Use a suitable regulated supply for the board.

## 4. See real data

1. Power the MiFi and let it establish internet access, then power the NodeMCU and receiver. Internet access must also permit network time (SNTP); TLS waits for the UTC clock.
2. Sign in to FLIGHT DECK. In Settings, confirm aircraft ID **FD-001** in your owner workspace.
3. Select **LIVE** in the header, then **Sensors & Calibration** or **Live Flight Monitor**. The MPU can appear even when the Nano UART is absent; receiver data will show unavailable.
4. Slowly tilt the stationary sensor and verify the pitch/roll signs, accelerometer axes and angular rates. Confirm timestamps advance. Disconnect the IMU to verify missing values, and disconnect MiFi internet to verify Stale. Restore connections and verify recovery before proceeding.

Delivered readings: raw acceleration (including gravity), angular rates, chip temperature, estimated pitch/roll, actual IMU sampling rate, calibrated aircraft voltage, Wi-Fi RSSI and reported Nano mode/mix/link state and output pulse widths. Pulse widths are **commands in microseconds**, not measured angles or proof of servo motion.

The existing Nano UART v1 does not report transmitter voltage, raw control inputs, packet counters, normalized surface positions, saturation, configuration version or armed state. These stay **Unknown**. No GPS, compass heading, altitude, speed, current, remaining flight time or stabilization is inferred. A future Nano protocol update is needed for additional transmitter telemetry.

## 5. Mounting and battery calibration

`Config.h` maps sensor axes to aircraft body X forward, Y right, Z down. The example assumes sensor X forward, Y left, Z up. Adjust `BODY_AXIS` and `BODY_SIGN` to the actual mounting; the compiler checks a valid right-handed rotation. At rest in the correct level orientation, body acceleration is approximately X=0, Y=0, Z=−9.81 m/s² (specific force, gravity included). Verify known tilts before relying on the display.

The complementary attitude estimator is for visualization, not stabilization. Maneuver acceleration can distort gravity-based attitude. It resets after sampling gaps and suppresses attitude near vertical or when initialization is unreliable. Yaw and gravity-compensated acceleration are not provided. `IMU_CALIBRATION_VERIFIED` defaults to false. Measure gyro biases at rest and use a proper multi-orientation accelerometer calibration before marking calibration verified. Offsets in `Config.h` are body-frame units: m/s² and degrees/s. Dashboard mounting/calibration settings are saved configuration, not firmware updates.

Battery reporting defaults to **Unknown** until `VOLTAGE_CALIBRATED` is true and a measured `MV_PER_COUNT` is supplied. First verify the electrical divider range. Then open local diagnostics to read ADC counts at a stable pack voltage measured with a multimeter. For an initial zero-offset scale: `MV_PER_COUNT = measured_pack_millivolts / ADC_count`. Prefer a two-point fit: gain=(mV2−mV1)/(count2−count1), offset=mV1−gain×count1. Enter gain/offset in `Config.h`, set `VOLTAGE_CALIBRATED=true`, reupload and compare across the working range. Clipped ADC readings are rejected. Chemistry and cell count remain independently configurable in the dashboard. Do not apply the voltage divider gain twice.

## 6. Troubleshooting on the MiFi network

Find **flight-deck-node** in your MiFi's connected-device list. Open `http://THE_ASSIGNED_IP/` on a phone/computer connected to the same MiFi. This read-only page reports Wi-Fi, clock, MPU, UART, raw ADC, heap and the last upload result. It does not reveal credentials or offer controls. Client isolation may prevent access. This private address is not a public dashboard URL.

| Result | Action |
| --- | --- |
| No device in MiFi list | Check 2.4 GHz network, SSID/password, power and upload |
| Clock waiting | Check internet and UDP network-time access |
| HTTP 0 | Upload not attempted yet; fill `Secrets.h`, allow Wi-Fi/time to connect |
| HTTP −1 / TLS error | Check internet, DNS, UTC and trust roots; do not disable certificate verification |
| HTTP 200 | Latest upload accepted; confirm matching owner workspace and `FD-001` in the dashboard |
| HTTP 400 | Redeploy the latest ingestion function; check matching device ID and schema |
| HTTP 401/403 | Check shared token on both sides and the documented platform JWT setting |
| HTTP 409 | Check for another powered device using the same ID, sequence/rate conflicts |
| HTTP 422 | Sample arrived over 2 s old or device clock was over 5 s ahead; check clock and network performance |
| HTTP 5xx | Check Supabase function logs, existing database migration and server secrets |
| MPU missing | Check supply, I²C wiring and address 0x68; use 0x69 in `Config.h` if AD0 is high |
| UART missing/stale | Check common ground, crossed wires, level shifter and matching Nano v1 firmware at 38400 baud |

Target upload rate is 5 Hz, not a guarantee. ESP8266 TLS and mobile round trips can reduce it and interrupt sensor sampling; the displayed sample rate includes these gaps. Old samples are never queued for later delivery. Ingestion rejects expired capture times; the browser marks stale data using both capture and receive times. Timestamp difference is not a calibrated one-way latency measurement. If mobile latency prevents useful monitoring, lower the upload target and evaluate a dedicated telemetry gateway or different telemetry processor after measuring the bottleneck. Do not tie Nano control timing to HTTPS.

Battery feedback still uses the existing Nano UART/ACK path. During a long TLS operation, battery feedback can become stale; the Nano must not treat missing voltage as a healthy pack. The physical transmitter can continue controlling through its independent radio link without the dashboard or MiFi.

## Contract and validation

Radio payloads remain the original compact Nano format, maximum 32 bytes. The UART frame is `A5 5A TYPE LENGTH PAYLOAD CRC_LO CRC_HI`, CRC16-CCITT-FALSE over type, length and payload. Type 1 is the existing 14-byte battery packet to the Nano; type 2 is its existing 26-byte receiver-status packet. `FlightDeckProtocol.h` is unchanged from the Nano v1 release. JSON is used only for the NodeMCU-to-Supabase HTTPS envelope, with version, boot ID, sequence, uptime, UTC capture time, units and validity.

Compiled for ESP8266 core 3.1.2 and ArduinoJson 6.21.5. The actual C++ serializer fixtures are checked against the dashboard and deployed-function schemas, including missing sensors, stale UART, PWM-only outputs and old capture times. Compilation and these tests do not verify physical wiring, TLS on your MiFi, sensor calibration, radio behavior or airworthiness. Bench hardware verification is still required.

References: [MPU6050 guide](https://learn.adafruit.com/mpu6050-6-dof-accelerometer-and-gyro/overview), [ESP8266 secure client](https://arduino-esp8266.readthedocs.io/en/latest/esp8266wifi/bearssl-client-secure-class.html), [ESP8266 ADC/UART reference](https://arduino-esp8266.readthedocs.io/en/latest/reference.html), [Supabase function secrets](https://supabase.com/docs/guides/functions/secrets). Public TLS roots in `TrustAnchors.h` are from [Google Trust Services](https://pki.goog/repository/) and [Let's Encrypt](https://letsencrypt.org/certificates/); maintain them as certificate chains change.

#pragma once
#include <stdint.h>
// WIRE FORMAT PROPOSAL ONLY. Not a radio controller or flight-ready firmware.
// Explicit little-endian encoding; do not transmit compiler-native structs.
// Offsets: 0 version, 1 flags, 2 seq16, 4 boot16, 6 rudder16,
// 8 elevator16, 10 joy2x16, 12 joy2y16, 14 throttle16,
// 16 pot1_16, 18 pot2_16, 20 tx_battery_mV16, 22 buttons, 23 reserved.
// Total: 24 bytes, within nRF24's 32-byte maximum payload.
// Signed axes: -1000..1000. Throttle: 0..1000. Voltage: 0xffff unknown.
// Buttons bit0 MIX_ON, bit1 MIX_OFF, bit2 AUX_IN, bit3 AUX_OUT.
// Receiver must debounce, latch mix state and resolve conflicts locally.
constexpr uint8_t FD_RADIO_VERSION=1;
constexpr uint8_t FD_RADIO_BYTES=24;
inline uint16_t fd_read_u16(const uint8_t* p){return uint16_t(p[0])|(uint16_t(p[1])<<8);}
inline void fd_write_u16(uint8_t* p,uint16_t v){p[0]=v&255;p[1]=v>>8;}
// Hardware addresses, RF settings, authenticated pairing and failsafe outputs
// must be provisioned and validated separately. This header drives no pins.

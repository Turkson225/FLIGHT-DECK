#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace fd {
// Both ATmega328P and ESP8266 use little endian. Never send native float/int.
constexpr uint8_t VERSION = 1;
constexpr uint16_t RADIO_MAGIC = 0xFDC1, ACK_MAGIC = 0xFDA1;
constexpr uint16_t PAIR_ID = 0x2251; // Change together on YOUR two radios.
constexpr uint8_t ADDRESS[6] = "FD225";
constexpr uint8_t RF_CHANNEL = 76; // 2476 MHz; check local requirements.
constexpr uint16_t UNKNOWN = 65535;
enum Mode : uint8_t { MANUAL, TAKEOFF, CRUISE, LANDING };
enum Command : uint8_t { NONE, SET_MIX, SET_MODE, PARACHUTE };
enum Result : uint8_t { NO_RESULT, ACCEPTED, APPLIED, REJECTED_UNSUPPORTED,
  REJECTED_THROTTLE, REJECTED_BUSY, REJECTED_CONFIG, REJECTED_EXPIRED };
enum TxFlag : uint8_t { TX_BAT_VALID = 1 };
enum AckFlag : uint8_t { BAT_VALID = 1, UART_OK = 2, RC_OK = 4,
  THROTTLE_LOCKED = 8, INSPECT_ACTIVE = 16, INSPECT_DONE = 32,
  CONFIG_FAULT = 64, SURFACES_ENABLED = 128 };
enum Capability : uint8_t { CAP_MIX = 1, CAP_MODES = 2, CAP_INSPECT = 4 };

struct __attribute__((packed)) Inputs {
  int16_t rudder, elevator, leftOrRoll, rightOrCommon, throttle, aux1, aux2;
};
struct __attribute__((packed)) ControlPacket {
  uint16_t magic;
  uint8_t version, flags;
  uint16_t pairId, sequence, txBoot;
  Inputs input;
  uint16_t eventId;
  uint8_t command, value;
  uint16_t txMillivolts;
};
struct __attribute__((packed)) AckPacket {
  uint16_t magic;
  uint8_t version, flags;
  uint16_t pairId, txBoot, rxBoot, sequence, echoSequence, eventId;
  uint8_t result, mode, mix, capabilities;
  uint16_t aircraftMillivolts, batteryAgeMs, sampleSequence;
  uint16_t receivedPackets, sequenceGaps, uartAgeMs;
};
struct __attribute__((packed)) BatteryPacket {
  uint8_t version, valid;
  uint16_t bootId, sequence;
  uint32_t sampleUptimeMs;
  uint16_t millivolts, sampleAgeMs;
};
// Nano -> NodeMCU diagnostic frame, NOT the dashboard JSON contract.
struct __attribute__((packed)) ReceiverStatus {
  uint8_t version, flags;
  uint16_t bootId, sequence;
  uint32_t uptimeMs;
  uint16_t outputUs[5]; // left/right/elevator/rudder/ESC commanded PWM
  uint8_t mode, mix, result, reserved;
  uint16_t eventId;
};
static_assert(sizeof(ControlPacket) == 30, "Radio layout changed");
static_assert(sizeof(AckPacket) == 32, "ACK must fit nRF24");
static_assert(sizeof(BatteryPacket) == 14, "UART battery layout changed");
static_assert(sizeof(ReceiverStatus) == 26, "UART status layout changed");

inline bool newer(uint16_t a, uint16_t b) {
  const uint16_t d = uint16_t(a - b); return d != 0 && d < 32768;
}
inline uint16_t age16(uint32_t age) { return age >= UNKNOWN ? UNKNOWN - 1 : uint16_t(age); }
inline uint16_t crc16(const uint8_t* p, size_t n) {
  uint16_t crc = 0xFFFF;
  while (n--) { crc ^= uint16_t(*p++) << 8;
    for (uint8_t i = 0; i < 8; ++i) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  } return crc;
}
inline bool validControl(const ControlPacket& p) {
  const Inputs& a = p.input;
  return p.magic == RADIO_MAGIC && p.version == VERSION && p.pairId == PAIR_ID &&
    (p.flags & ~TX_BAT_VALID) == 0 && a.rudder >= -1000 && a.rudder <= 1000 &&
    a.elevator >= -1000 && a.elevator <= 1000 && a.leftOrRoll >= -1000 && a.leftOrRoll <= 1000 &&
    a.rightOrCommon >= -1000 && a.rightOrCommon <= 1000 && a.throttle >= 0 && a.throttle <= 1000 &&
    a.aux1 >= -1000 && a.aux1 <= 1000 && a.aux2 >= -1000 && a.aux2 <= 1000 &&
    p.command <= PARACHUTE && (p.command != SET_MIX || p.value <= 1) &&
    (p.command != SET_MODE || p.value <= LANDING);
}

// Fixed-length binary framing: A5 5A TYPE LEN PAYLOAD CRC16(low,high).
// CRC covers TYPE,LEN,PAYLOAD. Bounded work/buffers; partial frame times out.
class UartParser {
  uint8_t state_ = 0, used_ = 0, expected_ = 0;
  uint32_t lastByte_ = 0;
  uint8_t data_[36] = {};
public:
  bool feed(uint8_t b, uint32_t now) {
    if (state_ && uint32_t(now - lastByte_) > 30) state_ = 0;
    lastByte_ = now;
    if (state_ == 0) { if (b == 0xA5) state_ = 1; return false; }
    if (state_ == 1) { state_ = b == 0x5A ? 2 : b == 0xA5 ? 1 : 0; return false; }
    if (state_ == 2) { data_[0] = b; state_ = 3; return false; }
    if (state_ == 3) {
      if (!b || b > 32) { state_ = 0; return false; }
      data_[1] = b; expected_ = b + 4; used_ = 2; state_ = 4; return false;
    }
    data_[used_++] = b;
    if (used_ != expected_) return false;
    state_ = 0;
    return crc16(data_, expected_ - 2) ==
      uint16_t(data_[expected_ - 2] | (uint16_t(data_[expected_ - 1]) << 8));
  }
  uint8_t type() const { return data_[0]; }
  uint8_t length() const { return data_[1]; }
  const uint8_t* payload() const { return data_ + 2; }
};
template<class StreamT, class PayloadT>
bool writeUart(StreamT& stream, uint8_t type, const PayloadT& payload) {
  static_assert(sizeof(PayloadT) <= 32, "UART payload too big");
  uint8_t frame[sizeof(PayloadT) + 6] = {0xA5, 0x5A, type, sizeof(PayloadT)};
  memcpy(frame + 4, &payload, sizeof(PayloadT));
  const uint16_t crc = crc16(frame + 2, sizeof(PayloadT) + 2);
  frame[sizeof(frame) - 2] = uint8_t(crc); frame[sizeof(frame) - 1] = uint8_t(crc >> 8);
  if (stream.availableForWrite() < int(sizeof(frame))) return false; // Drop, never block/queue.
  return stream.write(frame, sizeof(frame)) == sizeof(frame);
}
}

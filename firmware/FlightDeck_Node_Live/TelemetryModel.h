#pragma once
#include <stdint.h>
#include <math.h>
#include "FlightDeckProtocol.h"
namespace live {
constexpr float G = 9.80665f, DEG = 57.295779513f;
struct SensorSample {
  float accel[3] = {}, gyro[3] = {}, temperature = 0;
  float pitch = 0, roll = 0, sampleHz = 0;
  bool valid = false, attitudeValid = false;
  uint32_t at = 0;
};
inline float wrapDegrees(float a) {
  while(a > 180) a -= 360;
  while(a < -180) a += 360;
  return a;
}
class AttitudeEstimate {
  bool initialized_ = false;
  uint32_t at_ = 0;
  float roll_ = 0, pitch_ = 0;
public:
  void reset() { initialized_ = false; }
  void update(SensorSample& s) {
    s.attitudeValid = false;
    if (!s.valid) { reset(); return; }
    const float ax=s.accel[0], ay=s.accel[1], az=s.accel[2];
    const float norm=sqrtf(ax*ax+ay*ay+az*az);
    const bool gravityUsable=norm>0.85f*G && norm<1.15f*G;
    const float accelRoll=atan2f(-ay,-az)*DEG;
    const float accelPitch=atan2f(ax,sqrtf(ay*ay+az*az))*DEG;
    const float dt=uint32_t(s.at-at_)/1000.0f;
    if (!initialized_ || dt>0.1f || fabsf(pitch_)>80) {
      if (!gravityUsable || fabsf(accelPitch)>80) { reset(); at_=s.at; return; }
      roll_=accelRoll; pitch_=accelPitch; initialized_=true;
    } else if(dt>0) {
      const float r=roll_/DEG,p=pitch_/DEG;
      roll_=wrapDegrees(roll_+(s.gyro[0]+sinf(r)*tanf(p)*s.gyro[1]+cosf(r)*tanf(p)*s.gyro[2])*dt);
      pitch_+=(cosf(r)*s.gyro[1]-sinf(r)*s.gyro[2])*dt;
      if(gravityUsable) {
        const float correction=dt/(0.5f+dt);
        roll_=wrapDegrees(roll_+correction*wrapDegrees(accelRoll-roll_));
        pitch_+=correction*(accelPitch-pitch_);
      }
    }
    at_=s.at;
    if(!isfinite(roll_)||!isfinite(pitch_)||fabsf(pitch_)>85) { reset(); return; }
    s.roll=roll_;s.pitch=pitch_;s.attitudeValid=true;
  }
};
struct Snapshot {
  SensorSample imu;
  fd::ReceiverStatus receiver = {};
  bool uartFresh = false, batteryValid = false, wifiConnected = false;
  float aircraftVoltage = 0;
  int32_t wifiRssi = 0;
  uint32_t uptimeMs = 0, sequence = 0;
  double sampledAt = 0;
  const char* deviceId = "FD-001";
  const char* bootId = "uninitialized";
};
inline bool validReceiver(const fd::ReceiverStatus& s) {
  if(s.version!=fd::VERSION || s.mode>fd::LANDING || s.mix>1 || s.result>fd::REJECTED_EXPIRED) return false;
  for(uint8_t i=0;i<5;++i) if(s.outputUs[i]<500 || s.outputUs[i]>2500) return false;
  return true;
}
}

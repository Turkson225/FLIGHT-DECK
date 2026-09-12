#pragma once
#include <ArduinoJson.h>
#include "TelemetryModel.h"
namespace live {
template<typename Target> inline void numberOrNull(Target target, bool valid, float value) {
  if(valid && isfinite(value)) target.set(value); else target.set(nullptr);
}
inline void vectorJson(JsonObject o,const float v[3],bool valid) {
  const char* keys[]={"x","y","z"};
  for(uint8_t i=0;i<3;++i)numberOrNull(o[keys[i]],valid,v[i]);
}
// Same builder is compiled on ESP8266 and tested against the dashboard's Zod schemas.
inline bool buildTelemetry(JsonDocument& doc,const Snapshot& s,bool calibrated) {
  doc.clear();auto f=doc.createNestedObject("frame");
  f["schemaVersion"]=1;f["source"]="LIVE";f["deviceId"]=s.deviceId;f["bootId"]=s.bootId;
  f["seq"]=s.sequence;f["uptimeMs"]=s.uptimeMs;f["receivedAt"]=0;f["sampledAt"]=s.sampledAt;
  auto attitude=f.createNestedObject("attitude");
  numberOrNull(attitude["pitch"],s.imu.attitudeValid,s.imu.pitch);
  numberOrNull(attitude["roll"],s.imu.attitudeValid,s.imu.roll);attitude["yaw"]=nullptr;
  vectorJson(f.createNestedObject("accel"),s.imu.accel,s.imu.valid);
  vectorJson(f.createNestedObject("gyro"),s.imu.gyro,s.imu.valid);
  f["linearAcceleration"]=nullptr;numberOrNull(f["chipTemp"],s.imu.valid,s.imu.temperature);
  numberOrNull(f["sampleHz"],s.imu.valid && s.imu.sampleHz>0,s.imu.sampleHz);
  numberOrNull(f["aircraftVoltage"],s.batteryValid,s.aircraftVoltage);
  f["transmitterVoltage"]=nullptr;f["radio"]=nullptr;
  auto links=f.createNestedObject("links");links["uart"]=s.uartFresh;links["wifi"]=s.wifiConnected;
  if(s.uartFresh)links["radio"]=bool(s.receiver.flags&fd::RC_OK);else links["radio"]=nullptr;
  // Successful server receipt proves this sample traversed the uplink; not future availability.
  links["uplink"]=true;
  numberOrNull(f["wifiRssi"],s.wifiConnected,float(s.wifiRssi));f["imu"]=s.imu.valid;
  f["armed"]=nullptr;f["inputs"]=nullptr;f["configVersion"]=nullptr;f["safety"]=nullptr;
  if(s.uartFresh) {
    const char* modes[]={"Manual RC","Takeoff preset","Cruise preset","Landing preset"};
    f["mode"]=modes[s.receiver.mode];f["mixEnabled"]=bool(s.receiver.mix);
  }else {f["mode"]=nullptr;f["mixEnabled"]=nullptr;}
  auto outputs=f.createNestedObject("outputs");
  if(s.uartFresh) {
    const char* names[]={"leftAileron","rightAileron","elevator","rudder","throttle"};
    for(uint8_t i=0;i<5;++i) {
      if(i<4 && !(s.receiver.flags&fd::SURFACES_ENABLED))continue;
      auto o=outputs.createNestedObject(names[i]);o["pwm"]=s.receiver.outputUs[i];
      o["normalized"]=nullptr;o["saturated"]=nullptr; // Not present in Nano UART v1.
    }
  }
  auto validity=f.createNestedObject("validity");
  validity["imu"]=s.imu.valid?"valid":"invalid";
  validity["attitude"]=s.imu.attitudeValid?"valid":"unknown";
  validity["imuCalibration"]=calibrated?"valid":"unknown";
  validity["aircraftBattery"]=s.batteryValid?"valid":"unknown";
  validity["transmitterBattery"]="unknown";validity["uart"]=s.uartFresh?"valid":"unknown";
  validity["linearAcceleration"]="unsupported";validity["navigation"]="not_installed";
  validity["safety"]="unsupported";validity["inputs"]="unsupported";
  auto c=doc.createNestedObject("capabilities");
  c["schemaVersion"]=1;c["deviceId"]=s.deviceId;c["bootId"]=s.bootId;
  auto firmware=c.createNestedObject("firmware");
  firmware["nano"]=s.uartFresh?"UART v1; build version not reported":"Unknown";
  firmware["node"]="flight-deck-node/1.0.0";
  auto features=c.createNestedObject("features");features["attitude"]=true;
  const char* unsupported[]={"relativeYaw","linearAcceleration","gps","airspeed","barometer","stabilization",
    "autopilot","servoFeedback","flightMixTransitions","transmitterBuzzerConfig","parachute",
    "parachuteFeedback","flightFailureDetection","takeoffReadiness"};
  for(const char* key:unsupported)features[key]=false;
  c.createNestedArray("commands");auto maintenance=c.createNestedObject("maintenance");
  maintenance["authorized"]=false;maintenance["expiresAt"]=0;
  auto units=c.createNestedObject("units");units["acceleration"]="m/s2";units["angularVelocity"]="deg/s";
  units["attitude"]="deg";units["voltage"]="V";units["pwm"]="us";
  return !doc.overflowed();
}
}

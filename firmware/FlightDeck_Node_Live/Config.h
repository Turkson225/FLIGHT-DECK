#pragma once
#include <stdint.h>
namespace livecfg {
constexpr char HOST[] = "zqhhoiqmnzmsrendkive.supabase.co";
constexpr char PATH[] = "/functions/v1/telemetry-ingest";
constexpr char DEVICE_ID[] = "FD-001";
constexpr uint8_t SDA_PIN = 4, SCL_PIN = 5, MPU_ADDRESS = 0x68;
constexpr uint16_t SENSOR_PERIOD_MS = 10, POST_PERIOD_MS = 200; // targets, not guarantees
constexpr uint16_t UART_FRESH_MS = 350;
constexpr uint16_t NETWORK_TIMEOUT_MS = 1800;
// Sensor axes -> body X forward, Y right, Z down. Example mounting only!
// Default assumes sensor X points forward, sensor Y left, sensor Z up.
constexpr uint8_t BODY_AXIS[3] = {0,1,2};
constexpr int8_t BODY_SIGN[3] = {1,-1,-1};
static_assert(BODY_AXIS[0]<3&&BODY_AXIS[1]<3&&BODY_AXIS[2]<3&&
  BODY_AXIS[0]!=BODY_AXIS[1]&&BODY_AXIS[0]!=BODY_AXIS[2]&&BODY_AXIS[1]!=BODY_AXIS[2],"Body axes must be a permutation of 0,1,2");
static_assert((BODY_SIGN[0]==1||BODY_SIGN[0]==-1)&&(BODY_SIGN[1]==1||BODY_SIGN[1]==-1)&&
  (BODY_SIGN[2]==1||BODY_SIGN[2]==-1),"Body signs must be +1 or -1");
static_assert((int(BODY_AXIS[0])-BODY_AXIS[1])*(int(BODY_AXIS[1])-BODY_AXIS[2])*
  (int(BODY_AXIS[2])-BODY_AXIS[0])*BODY_SIGN[0]*BODY_SIGN[1]*BODY_SIGN[2]==2,"Mounting must preserve a right-handed body frame");
// Body-frame offsets, measured with a stationary sensor. No automatic calibration/servo requests.
constexpr float GYRO_BIAS_DPS[3] = {0,0,0};
constexpr float ACCEL_BIAS_MS2[3] = {0,0,0};
constexpr bool IMU_CALIBRATION_VERIFIED = false;
constexpr bool VOLTAGE_CALIBRATED = false;
constexpr float MV_PER_COUNT = 0.0f, MV_OFFSET = 0.0f;
// NodeMCU ADC divider limits MUST be verified physically; software gain cannot protect A0.
}

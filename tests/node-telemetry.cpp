#include <cassert>
#include <iostream>
#include <chrono>
#include "../firmware/FlightDeck_Node_Live/TelemetryJson.h"
int main() {
  live::AttitudeEstimate estimator;live::SensorSample sample;
  sample.valid=true;sample.accel[2]=-live::G;sample.at=10;estimator.update(sample);
  assert(sample.attitudeValid&&fabs(sample.roll)<.01&&fabs(sample.pitch)<.01);
  sample.at=20;sample.accel[1]=-live::G*.5;sample.accel[2]=-live::G*.8660254;
  estimator.reset();estimator.update(sample);assert(fabs(sample.roll-30)<.01);
  sample.at=30;sample.accel[0]=live::G*.3420201;sample.accel[1]=0;sample.accel[2]=-live::G*.9396926;
  estimator.reset();estimator.update(sample);assert(fabs(sample.pitch-20)<.01);
  sample.valid=false;sample.at=40;estimator.update(sample);assert(!sample.attitudeValid);
  sample.valid=true;sample.at=5000;sample.accel[0]=0;sample.accel[1]=0;sample.accel[2]=-3*live::G;
  estimator.update(sample);assert(!sample.attitudeValid); // Do not initialize attitude from high linear acceleration.
  for(int scenario=0;scenario<4;++scenario) {
    live::Snapshot s;s.deviceId="FD-001";s.bootId="esp-test-fixture";s.sequence=scenario+1;s.uptimeMs=1000+scenario*200;
    s.sampledAt=std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    s.imu.valid=scenario!=1;s.imu.attitudeValid=scenario!=1;s.imu.accel[2]=-live::G;
    s.imu.temperature=31.5;s.imu.sampleHz=90;s.uartFresh=scenario!=2;s.wifiConnected=true;s.wifiRssi=-55;
    s.batteryValid=scenario!=3;s.aircraftVoltage=12.1;s.receiver.version=1;
    s.receiver.flags=fd::RC_OK|fd::SURFACES_ENABLED|fd::THROTTLE_LOCKED;s.receiver.mix=1;
    for(int i=0;i<4;++i)s.receiver.outputUs[i]=1500;
    s.receiver.outputUs[4]=1000;
    assert(live::validReceiver(s.receiver));
    DynamicJsonDocument document(6144);assert(live::buildTelemetry(document,s,false));
    assert(measureJson(document)<4096);
    serializeJson(document,std::cout);std::cout<<'\n';
  }
}

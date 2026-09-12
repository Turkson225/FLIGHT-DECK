#pragma once
#include <stdint.h>
#include <math.h>
// Reference state machine only. No pin writes, no ESC, no Servo library dependency.
// Nano firmware must run its radio loop/watchdog first, then decide control authority.
struct InspectionGates { bool configured, disarmed, throttleLow, localAuthorized, stationary, radioFresh, pilotOverride; };
struct InspectionOutput { float degrees[4]; bool ownsSurfaces; bool completed; };
class StartupInspection {
 uint32_t bootMs, lastTick; bool decided=false, finished=false;
 public:
 explicit StartupInspection(uint32_t now):bootMs(now),lastTick(now){}
 InspectionOutput tick(uint32_t now, const InspectionGates& g, float amplitudeDegrees) {
  InspectionOutput o={{0,0,0,0},false,finished};
  if(finished)return o;
  uint32_t elapsed=now-bootMs, gap=now-lastTick; lastTick=now;
  bool allowed=g.configured&&g.disarmed&&g.throttleLow&&g.localAuthorized&&g.stationary&&g.radioFresh&&!g.pilotOverride;
  // Missing a gate at the decision point skips this boot; never queues for reconnect.
  if(elapsed<5000)return o;
  if(!decided){decided=true;if(!allowed||elapsed>5250){finished=true;o.completed=true;return o;}}
  if(!allowed||gap>200){finished=true;o.completed=true;return o;}
  if(elapsed>=13000){finished=true;o.completed=true;o.ownsSurfaces=true;return o;}
  float a=fmaxf(0,fminf(10,amplitudeDegrees));
  float wave=sinf((elapsed-5000)/8000.0f*6.2831853f);
  float value=a*wave*wave*wave;
  o.degrees[0]=value;o.degrees[1]=-value;o.degrees[2]=value;o.degrees[3]=value;o.ownsSurfaces=true;return o;
 }
};
// Clip degrees to measured travel, then apply servo installation direction/trim/PWM limits.
// On ownsSurfaces=false immediately use onboard RC/failsafe authority, not browser state.
// New instance only on MCU boot; never recreate on network reconnection.

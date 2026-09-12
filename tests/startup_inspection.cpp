#include "../integration/startup_inspection.h"
#include <assert.h>
int main(){
 InspectionGates good={true,true,true,true,true,true,false};
 StartupInspection test(0);for(unsigned t=0;t<5000;t+=20)assert(!test.tick(t,good,5).ownsSurfaces);
 assert(test.tick(5000,good,5).ownsSurfaces);for(unsigned t=5020;t<7000;t+=20)test.tick(t,good,5);
 auto o=test.tick(7000,good,5);assert(o.ownsSurfaces&&o.degrees[0]>4.9f);
 good.pilotOverride=true;assert(!test.tick(7020,good,5).ownsSurfaces);good.pilotOverride=false;assert(!test.tick(7040,good,5).ownsSurfaces);
 StartupInspection skipped(0);assert(!skipped.tick(9000,good,5).ownsSurfaces);assert(!skipped.tick(9020,good,5).ownsSurfaces);
 StartupInspection blocked(0);good.localAuthorized=false;assert(!blocked.tick(5000,good,5).ownsSurfaces);good.localAuthorized=true;assert(!blocked.tick(5020,good,5).ownsSurfaces);
}

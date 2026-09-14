import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,demoCapabilities,simulate,emptyFrame,sanitizeTelemetry,newId,csvFor,commandRejection} from '../lib/flight.ts';
import {frameSchema,recordingSchema,commandSchema,eventSchema} from '../lib/contracts.ts';
import {parachuteRejection,preflightKeys,readyForTakeoff,recoveryLabel,sanitizeSafety} from '../lib/safety.ts';
import {voiceSnapshot,voiceTransitions,parseVoice,AnnouncementQueue} from '../lib/announcements.ts';
const now=10000;
const settings=()=>({...structuredClone(defaultSettings),preflight:Object.fromEntries(preflightKeys.map(k=>[k,true]))});
function setup(scenario='stationary'){
 const s=settings(),f=simulate(0,scenario,s,now);
 return {environment:'DEMO',frame:f,settings:s,capabilities:structuredClone(demoCapabilities),now,backend:true,recording:false};
}
test('parachute requires a cover, fresh DEMO telemetry, and a single deployment',()=>{
 const x={...setup(),authenticated:false,guardOpen:false,deployed:false};
 assert.match(parachuteRejection(x),/cover/);
 assert.equal(parachuteRejection({...x,guardOpen:true}),null);
 assert.match(parachuteRejection({...x,guardOpen:true,deployed:true}),/already/);
 assert.match(parachuteRejection({...x,guardOpen:true,now:now+2001}),/Fresh/);
 assert.match(parachuteRejection({...x,guardOpen:true,frame:{...x.frame,source:'LIVE'}}),/simulator/);
});
test('LIVE and REPLAY cannot enter the deployment simulation even with complete capabilities',()=>{
 const x={...setup(),authenticated:true,role:'owner',guardOpen:true,deployed:false};
 assert.match(parachuteRejection({...x,environment:'REPLAY'}),/Replay/);
 assert.match(parachuteRejection({...x,environment:'LIVE'}),/disabled/);
 assert.match(parachuteRejection({...x,environment:'LIVE',role:'viewer'}),/Owner or Operator/);
 assert.match(commandRejection({kind:'parachute.deploy'},{}),/separate/);
});
test('deployment confirmation requires a deployment sensor and matching firmware report',()=>{
 const {frame:f,capabilities:c}=setup();f.safety.parachute.state='deployed';
 assert.match(recoveryLabel(f,c,now),/simulator/);
 for(const feedback of ['none','release_sensor'])assert.equal(sanitizeSafety({...f,safety:{...f.safety,parachute:{...f.safety.parachute,feedback}}},c).parachute.state,'unknown');
 assert.equal(sanitizeSafety(f,{...c,features:{...c.features,parachuteFeedback:false}}).parachute.state,'unknown');
 for(const mutation of [{bootId:'wrong'},{deviceId:'wrong'}])assert.equal(sanitizeSafety(f,{...c,...mutation}),null);
 assert.equal(sanitizeSafety({...f,links:{...f.links,uart:false}},c),null);
 assert.equal(sanitizeSafety({...f,validity:{...f.validity,safety:'invalid'}},c),null);
 assert.equal(recoveryLabel(f,c,now+2001),'Stale');
 f.safety.parachute.installed=false;assert.equal(recoveryLabel(f,c,now),'Not installed');
});
test('readiness needs explicit supported firmware, checks and measured conditions',()=>{
 const x=setup();assert.equal(readyForTakeoff(x.frame,x.settings,x.capabilities,now),true);
 for(const mutate of [f=>f.inputs=null,f=>f.inputs.throttle=.1,f=>f.armed=null,f=>f.armed=true,f=>f.imu=false,f=>f.links.radio=null,f=>f.links.uart=false,f=>f.aircraftVoltage=null,f=>f.transmitterVoltage=1,f=>f.safety.readyForTakeoff=null,f=>f.safety.flightFailure=true,f=>f.safety.parachute.state='deployed',f=>f.validity.imu='invalid',f=>f.validity.battery='invalid']){
  const f=structuredClone(x.frame);mutate(f);assert.equal(readyForTakeoff(f,x.settings,x.capabilities,now),false);
 }
 assert.equal(readyForTakeoff(x.frame,x.settings,x.capabilities,now+2001),false);
 assert.equal(readyForTakeoff(x.frame,defaultSettings,x.capabilities,now),false);
 assert.equal(readyForTakeoff(x.frame,x.settings,{...x.capabilities,features:{...x.capabilities.features,takeoffReadiness:false}},now),false);
});
test('safety is optional for old recordings, new recorded safety and audit survive JSON/CSV',()=>{
 const x=setup('failure');assert.ok(frameSchema.safeParse(x.frame).success);
 const old=emptyFrame();delete old.safety;assert.ok(frameSchema.safeParse(old).success);
 const command={id:newId(),aircraftId:'FD-001',issuer:'demo-guest',environment:'DEMO',kind:'parachute.deploy',parameters:{guardConfirmed:true},createdAt:now,expiresAt:now+5000,status:'Applied (simulator)',reason:'No hardware sent',sent:false};
 const event={environment:'DEMO',aircraftId:'FD-001',command,id:newId(),at:now,title:'Simulated recovery',detail:'No hardware',source:'Simulator',severity:'critical',acknowledged:false,resolved:false};
 const recording={id:newId(),name:'Recovery test',notes:'',createdAt:now,source:'DEMO',frames:[x.frame],events:[event],settings:x.settings};
 assert.deepEqual(recordingSchema.parse(JSON.parse(JSON.stringify(recording))),JSON.parse(JSON.stringify(recording)));
 assert.match(csvFor(recording),/flight_failure_reported,parachute_state,parachute_feedback/);
 assert.match(csvFor(recording),/"true","stowed","deployment_sensor"/);
 assert.equal(eventSchema.safeParse({...event,command:{...command,sent:true}}).success,false);
 assert.equal(eventSchema.safeParse({...event,command:{...command,parameters:{guardConfirmed:false}}}).success,false);
 assert.equal(commandSchema.parse({...command,schemaVersion:1}).kind,'parachute.deploy');
});
test('ingress sanitization removes unsupported safety claims',()=>{
 const x=setup('failure'),f=sanitizeTelemetry(x.frame,{...x.capabilities,features:{}});
 assert.equal(f.safety.flightFailure,null);assert.equal(f.safety.readyForTakeoff,null);assert.equal(f.safety.parachute,null);
});
test('connection loss never generates a flight-failure announcement',()=>{
 const x=setup('cruise'),before=voiceSnapshot(x);
 for(const scenario of ['radio','uart','internet','imu']){
  const after=voiceSnapshot({...x,frame:simulate(0,scenario,x.settings,now),now:scenario==='internet'?now+2001:now});
  const notices=voiceTransitions(before,after,now);
  assert.ok(!notices.some(n=>n.category==='failure'));assert.ok(notices.some(n=>n.category==='connections'||n.category==='sensors'));
 }
 const notices=voiceTransitions(before,voiceSnapshot(setup('failure')),now);
 assert.equal(notices.find(n=>n.category==='failure').text,'Demo. Flight failure reported.');
});
test('readiness phrases distinguish operator checks from confirmed readiness',()=>{
 const x=setup();assert.ok(voiceTransitions(null,voiceSnapshot(x),now).some(n=>n.text==='Demo. Preflight complete. Ready for takeoff.'));
 x.capabilities.features.takeoffReadiness=false;
 const notices=voiceTransitions(null,voiceSnapshot(x),now);
 assert.ok(!notices.some(n=>n.signal==='ready'));assert.ok(notices.some(n=>n.text.includes('Aircraft readiness not confirmed')));
 const live={...setup(),environment:'LIVE',backend:false};assert.equal(voiceSnapshot(live).signals.ready,null);
});
test('speech transitions are deduplicated, restore only after loss, replay is silent',()=>{
 const x=setup('cruise'),a=voiceSnapshot(x),lost=voiceSnapshot({...x,now:now+2100});
 assert.deepEqual(voiceTransitions(a,a,now),[]);
 assert.equal(voiceTransitions(a,lost,now+2100).filter(n=>n.signal==='telemetry').length,1);
 assert.match(voiceTransitions(lost,a,now+2200).find(n=>n.signal==='telemetry').text,/restored/);
 assert.ok(!voiceTransitions(null,a,now).some(n=>n.text.includes('restored')));
 assert.deepEqual(voiceTransitions(null,{...lost,environment:'REPLAY'},now),[]);
});
function queueSetup(){let time=0,stops=0;const spoken=[],callbacks=[];const q=new AnnouncementQueue((n,done)=>{spoken.push(n);callbacks.push(done)},()=>stops++,()=>time);return {q,spoken,callbacks,setTime:t=>time=t,stops:()=>stops};}
const notice=(key,priority=0,at=0)=>({key,signal:key,value:'active',text:key,category:'connections',priority,at});
test('speech is non-preemptive and critical notices wait for the current phrase',()=>{
 const x=queueSetup();x.q.enqueue([notice('ready')]);x.q.enqueue([notice('failure',2)]);
 assert.equal(x.stops(),0);assert.deepEqual(x.spoken.map(n=>n.key),['ready']);assert.equal(x.q.current.key,'ready');
 x.callbacks[0]();assert.deepEqual(x.spoken.map(n=>n.key),['ready','failure']);assert.equal(x.q.current.key,'failure');
 x.q.clear();x.callbacks[1]();assert.equal(x.q.current,null);assert.equal(x.q.pending.length,0);
});
test('queue expires old waiting speech, bounds backlog, deduplicates and drops resolved warnings',()=>{
 const x=queueSetup();x.q.enqueue([notice('loss',2),notice('loss',2),...Array.from({length:8},(_,i)=>notice('other'+i))]);
 assert.equal(x.spoken.length,1);assert.ok(x.q.pending.length<=4);
 x.q.reconcile(n=>n.key!=='loss');assert.equal(x.stops(),0);assert.equal(x.q.current.key,'loss');
 x.setTime(9000);x.q.reconcile(()=>true);assert.equal(x.q.pending.length,0);assert.equal(x.q.current.key,'loss');
 x.callbacks[0]();assert.equal(x.q.current,null);
 x.q.enqueue([notice('expired',2)]);assert.equal(x.q.current,null);
});
test('voice preferences fail closed and clamp invalid browser storage',()=>{
 assert.equal(parseVoice(null).enabled,false);assert.equal(parseVoice({enabled:'yes'}).enabled,false);
 const p=parseVoice({volume:99,rate:NaN,categories:{failure:false}});assert.equal(p.volume,1);assert.equal(p.rate,1);assert.equal(p.categories.failure,false);assert.equal(p.categories.connections,true);
});

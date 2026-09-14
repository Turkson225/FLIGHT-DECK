import test from 'node:test';
import assert from 'node:assert/strict';
import {newId,defaultSettings,zeroInputs,mixOutputs,latchMix,auxiliaryCommand,simulate,emptyFrame,faults,csvFor,seedRecordings,commandRejection,sanitizeTelemetry,demoCapabilities} from '../lib/flight.ts';
import {telemetryGapThreshold} from '../lib/telemetry-chart.ts';
import {settingsSchema,frameSchema,recordingSchema,commandSchema,roleCanWrite} from '../lib/contracts.ts';
const settings=()=>structuredClone(defaultSettings);
test('invalid validity flags suppress numeric values',()=>{const f=simulate(1,'cruise',settings(),1000);f.validity.imu='invalid';f.validity.aircraftBattery='invalid';const clean=sanitizeTelemetry(f,demoCapabilities);assert.equal(clean.attitude.roll,null);assert.equal(clean.accel.x,null);assert.equal(clean.aircraftVoltage,null);assert.notEqual(f.aircraftVoltage,null)});
test('all simulator scenarios are deterministic and schema-valid',()=>{for(const s of ['stationary','cruise','channels','battery','radio','uart','internet','imu','rejection']){const f=simulate(30,s,settings(),1000);assert.deepEqual(f,simulate(30,s,settings(),1000));assert.ok(frameSchema.safeParse(f).success)}});
test('missing telemetry remains null',()=>{const f=emptyFrame();for(const v of [f.attitude.roll,f.aircraftVoltage,f.armed,f.radio])assert.equal(v,null);assert.deepEqual(f.outputs,{})});
test('stationary raw acceleration includes gravity',()=>{const f=simulate(0,'stationary',settings(),1000);assert.equal(f.accel.z,-9.80665);assert.equal(f.gyro.x,0);assert.equal(f.armed,false)});
test('roll mixing produces opposite normalized deflections',()=>{const o=mixOutputs({...zeroInputs,leftAileron:.7},settings().mixer);assert.ok(o.leftAileron.normalized>0);assert.equal(o.leftAileron.normalized,-o.rightAileron.normalized)});
test('joystick 2 Y is ignored by default in mixed mode',()=>{const o=mixOutputs({...zeroInputs,rightAileron:1},settings().mixer);assert.equal(o.leftAileron.normalized,0);assert.equal(o.rightAileron.normalized,0)});
test('independent axes remain independent',()=>{const s=settings();s.mixer.enabled=false;const o=mixOutputs({...zeroInputs,leftAileron:.5,rightAileron:-.25},s.mixer);assert.ok(o.leftAileron.normalized>0&&o.rightAileron.normalized<0)});
test('common input requires opt-in and saturation is flagged',()=>{const s=settings();s.mixer.common=true;const o=mixOutputs({...zeroInputs,leftAileron:1,rightAileron:1},s.mixer);assert.equal(o.leftAileron.normalized,1);assert.equal(o.leftAileron.saturated,true);assert.equal(o.rightAileron.normalized,0)});
test('servo reversal and hard limits apply after mixing',()=>{const s=settings();s.mixer.channels.rightAileron.reverse=true;s.mixer.channels.leftAileron.max=1700;s.mixer.channels.leftAileron.subtrim=150;const o=mixOutputs({...zeroInputs,leftAileron:1},s.mixer);assert.equal(o.leftAileron.pwm,1700);assert.equal(o.leftAileron.saturated,true);assert.ok(o.rightAileron.pwm>1500)});
test('1600-input sweep never exceeds configured limits',()=>{const s=settings();s.mixer.strength=1.5;s.mixer.common=true;for(let x=-1;x<=1;x+=.05)for(let y=-1;y<=1;y+=.05){for(const [key,o] of Object.entries(mixOutputs({...zeroInputs,leftAileron:x,rightAileron:y},s.mixer))){assert.ok(o.pwm>=s.mixer.channels[key].min&&o.pwm<=s.mixer.channels[key].max);assert.ok(o.normalized>=-1&&o.normalized<=1)}}});
test('mix commands latch; conflicts retain confirmed state',()=>{for(const prior of [true,false]){assert.equal(latchMix(prior,false,false),prior);assert.equal(latchMix(prior,true,true),prior);assert.equal(latchMix(prior,true,false),true);assert.equal(latchMix(prior,false,true),false)}});
test('auxiliary release and conflict mean STOP',()=>{assert.equal(auxiliaryCommand(false,false),'STOP');assert.equal(auxiliaryCommand(true,true),'STOP');assert.equal(auxiliaryCommand(true,false),'IN');assert.equal(auxiliaryCommand(false,true),'OUT')});
test('fault scenarios generate meaningful alerts',()=>{for(const [s,key] of [['imu','imu'],['uart','uart'],['radio','radio'],['battery','battery-Aircraft']])assert.ok(faults(simulate(30,s,settings(),1000),31000,settings()).some(a=>a.key===key));assert.ok(faults(simulate(30,'cruise',settings(),1000),34001,settings()).some(a=>a.key==='stale'))});
test('UART loss invalidates dependent radio and outputs',()=>{const f=simulate(30,'uart',settings(),1000);assert.equal(f.inputs,null);assert.equal(f.radio,null);assert.equal(f.transmitterVoltage,null);assert.deepEqual(f.outputs,{})});
test('IMU loss never looks like level attitude',()=>{const f=simulate(30,'imu',settings(),1000);assert.deepEqual(f.attitude,{pitch:null,roll:null,yaw:null});assert.equal(f.chipTemp,null)});
test('CSV has one line per sample with blanks for missing values',()=>{const r=seedRecordings()[0];r.frames=[emptyFrame(),simulate(1,'cruise',settings(),1000)];const csv=csvFor(r);assert.equal(csv.split('\n').length,3);assert.match(csv.split('\n')[1],/,,,/);assert.equal(csv.split('\n')[0].split(',').length,csv.split('\n')[2].split(',').length)});
test('JSON preserves nulls and missing-data time gaps',()=>{const r=seedRecordings()[0];r.frames=[simulate(0,'cruise',settings(),1000),simulate(10,'imu',settings(),1000)];const copy=JSON.parse(JSON.stringify(r));assert.equal(copy.frames[1].receivedAt-copy.frames[0].receivedAt,10000);assert.equal(copy.frames[1].attitude.roll,null)});
test('chart gap detection adapts to live telemetry cadence',()=>{
 const times=(values)=>values.map(receivedAt=>({receivedAt}));
 assert.equal(telemetryGapThreshold(times([0,100,200,300])),600);
 assert.equal(telemetryGapThreshold(times([0,500,1000,1500])),1250);
 assert.equal(telemetryGapThreshold(times([0,1000,2000,3000])),2000);
 assert.equal(telemetryGapThreshold(times([0,10000])),2000);
});
const ctx={environment:'LIVE',role:'operator',now:10000,lastTelemetry:9900,maintenance:true,armed:false,capabilities:['servo.test'],seen:false},cmd={id:'00000000-0000-4000-8000-000000000001',aircraftId:'FD-001',kind:'servo.test',expiresAt:12000};
test('Viewer cannot write settings or authorize commands',()=>{assert.equal(roleCanWrite('viewer'),false);assert.equal(roleCanWrite('unknown'),false);assert.equal(roleCanWrite('operator'),true);assert.equal(roleCanWrite('owner'),true);assert.match(commandRejection(cmd,{...ctx,role:'viewer'}),/permission/)});
test('DEMO and REPLAY cannot authorize live transport',()=>{for(const environment of ['DEMO','REPLAY'])assert.match(commandRejection(cmd,{...ctx,environment}),/Environment/)});
test('expired, overlong and duplicate commands are rejected',()=>{assert.match(commandRejection({...cmd,expiresAt:9999},ctx),/Expired/);assert.match(commandRejection({...cmd,expiresAt:100000},ctx),/lifetime/);assert.match(commandRejection(cmd,{...ctx,seen:true}),/Duplicate/)});
test('reconnection does not revive expired commands',()=>assert.match(commandRejection(cmd,{...ctx,now:20000,lastTelemetry:19900}),/Expired/));
test('freshness, disarm and maintenance are separate gates',()=>{assert.match(commandRejection(cmd,{...ctx,lastTelemetry:1}),/Fresh/);for(const armed of [null,true])assert.match(commandRejection(cmd,{...ctx,armed}),/disarmed/);assert.match(commandRejection(cmd,{...ctx,maintenance:false}),/maintenance/)});
test('unsupported features and motor tests fail closed',()=>{assert.match(commandRejection(cmd,{...ctx,capabilities:[]}),/Unsupported/);assert.match(commandRejection({...cmd,kind:'motor.test'},{...ctx,capabilities:['motor.test']}),/separate/)});
test('valid pure gate never implies an enabled actuator transport',()=>assert.equal(commandRejection(cmd,ctx),null));
test('invalid endpoints and non-finite sensor readings are rejected',()=>{const s=settings();assert.ok(settingsSchema.safeParse(s).success);s.mixer.channels.rudder.min=2001;assert.equal(settingsSchema.safeParse(s).success,false);const f=emptyFrame();f.accel.x=NaN;assert.equal(frameSchema.safeParse(f).success,false)});
test('source mismatch and reordered sessions are rejected',()=>{const r=seedRecordings()[0];r.id=cmd.id;assert.ok(recordingSchema.safeParse(r).success);r.frames[0].source='LIVE';assert.equal(recordingSchema.safeParse(r).success,false);r.frames[0].source='DEMO';r.frames.reverse();assert.equal(recordingSchema.safeParse(r).success,false)});
test('command schemas do not trust a client-supplied issuer',()=>{const c=commandSchema.parse({...cmd,schemaVersion:1,environment:'LIVE',parameters:{},issuer:'pretend-owner'});assert.equal('issuer' in c,false)});

test('IDs work without secure-context randomUUID and retain UUID v4 format',()=>{const id=newId();assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.notEqual(id,newId())});
test('preflight fault persists until every required operator check is complete',()=>{const s=settings(),f=simulate(0,'stationary',s,1000);assert.ok(faults(f,1000,s).some(x=>x.key==='preflight'));for(const key of ['battery','surfaces','mixing','orientation','mechanical','failsafe'])s.preflight[key]=true;assert.ok(!faults(f,1000,s).some(x=>x.key==='preflight'))});

test('event exports retain environment, configuration and complete demo audit', async()=>{
 const {eventSchema}=await import('../lib/contracts.ts');
 const configuration=settings(),command={id:newId(),aircraftId:'FD-001',issuer:'demo-guest',environment:'DEMO',kind:'servo.test',parameters:{axis:'leftAileron',value:.2},createdAt:1000,expiresAt:2500,status:'Applied (simulator)',reason:'Simulator only',sent:false};
 const event={id:newId(),at:1000,title:'Bench test',detail:'No hardware sent',source:'Simulator',severity:'info',acknowledged:false,resolved:false,environment:'DEMO',aircraftId:'FD-001',configuration,command};
 assert.deepEqual(eventSchema.parse(JSON.parse(JSON.stringify(event))),event);
 assert.equal(eventSchema.safeParse({...event,command:{...command,sent:true}}).success,false);
 assert.equal(eventSchema.safeParse({...event,command:{...command,parameters:{axis:'throttle',value:1}}}).success,false);
 assert.equal(eventSchema.safeParse({...event,configuration:{...configuration,mixer:{...configuration.mixer,strength:99}}}).success,false);
});
test('legacy events remain readable with unknown environment',async()=>{
 const {eventSchema}=await import('../lib/contracts.ts');const event={id:'legacy',at:0,title:'Old event',detail:'',source:'Console',severity:'warning',acknowledged:true,resolved:false};assert.deepEqual(eventSchema.parse(event),event);
});

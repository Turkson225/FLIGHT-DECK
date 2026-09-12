import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {frameSchema,capabilitiesSchema} from '../lib/contracts.ts';
import {sanitizeTelemetry,faults,defaultSettings} from '../lib/flight.ts';
import {freshFrame} from '../lib/safety.ts';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/node-telemetry.json',import.meta.url),'utf8'));
test('ESP8266 C++ serializer fixtures satisfy the actual telemetry contract',()=>{
  for(const payload of fixtures){
    assert.ok(frameSchema.safeParse(payload.frame).success);
    assert.ok(capabilitiesSchema.safeParse(payload.capabilities).success);
    assert.equal(payload.frame.source,'LIVE');assert.deepEqual(payload.capabilities.commands,[]);
    assert.equal(payload.frame.attitude.yaw,null);assert.equal(payload.frame.transmitterVoltage,null);
    assert.equal(payload.frame.inputs,null);assert.equal(payload.frame.radio,null);
  }
});
test('PWM-only receiver output does not invent normalized deflection or saturation',()=>{
 const {frame,capabilities}=fixtures[0],clean=sanitizeTelemetry(frame,capabilities);
 assert.deepEqual(clean.outputs.leftAileron,{pwm:1500,normalized:null,saturated:null});
 assert.equal(clean.outputs.throttle.pwm,1000);assert.equal(clean.armed,null);
});
test('sensor failure, stale UART and uncalibrated battery remain unavailable',()=>{
 const [normal,missing,uart,battery]=fixtures;
 assert.equal(normal.frame.imu,true);
 const m=sanitizeTelemetry(missing.frame,missing.capabilities);assert.equal(m.accel.z,null);assert.equal(m.attitude.roll,null);
 const u=sanitizeTelemetry(uart.frame,uart.capabilities);assert.deepEqual(u.outputs,{});assert.equal(u.mode,null);
 assert.equal(u.links.radio,null);assert.equal(battery.frame.aircraftVoltage,null);
});
test('capture age prevents delayed internet samples being treated as newly measured',()=>{
 const f={...fixtures[0].frame,receivedAt:10000,sampledAt:7000};
 assert.equal(freshFrame(f,10001),false);
 assert.ok(faults(f,10001,defaultSettings).some(x=>x.key==='stale'));
 assert.equal(freshFrame({...f,sampledAt:9950},10001),true);
 assert.equal(freshFrame({...f,sampledAt:undefined},10001),true);
});

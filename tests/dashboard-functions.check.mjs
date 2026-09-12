import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {z} from 'zod';

const userId='10000000-0000-4000-8000-000000000001';
const otherId='20000000-0000-4000-8000-000000000002';
const origin='https://turkson225.github.io';
// Execute the exact dashboard bundles. Only the database/auth boundary is mocked;
// requests, validation, membership checks and rejection paths run the real code.
async function load(name,{role='owner',verified=true,validToken=true,env={}}={}){
  let handler;
  const writes=[];
  const client={
    auth:{getUser:async token=>validToken&&token==='test-session'?{data:{user:{id:userId,email:'owner@example.test',email_confirmed_at:verified?'2026-09-12T00:00:00Z':null}},error:null}:{data:{user:null},error:{message:'invalid'}}},
    from(table){
      const filters={};
      const chain={select(){return chain},eq(k,v){filters[k]=v;return chain},order(){return chain},
        async maybeSingle(){return {data:table==='fd_members'&&filters.workspace_id===userId&&filters.user_id===userId?{role}:null,error:null}},
        async limit(){return {data:[],error:null}},
        async insert(data){writes.push({table,data});return {data:null,error:null}},
        async upsert(data){writes.push({table,data});return {data:null,error:null}}};
      return chain;
    },
    async rpc(name,parameters){writes.push({rpc:name,parameters});return {data:true,error:null}}
  };
  const variables={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only',ALLOWED_ORIGINS:origin,...env};
  const context=vm.createContext({Request,Response,URL,TextEncoder,crypto:globalThis.crypto,Uint8Array,console,Deno:{env:{get:key=>variables[key]},serve:fn=>{handler=fn}}});
  const module=new vm.SourceTextModule(await readFile(new URL(`../supabase/dashboard/${name}.ts`,import.meta.url),'utf8'),{context});
  await module.link(specifier=>{
    if(specifier==='npm:@supabase/supabase-js@2.116.0')return new vm.SyntheticModule(['createClient'],function(){this.setExport('createClient',()=>client)},{context});
    if(specifier==='npm:zod@3.25.76')return new vm.SyntheticModule(['z'],function(){this.setExport('z',z)},{context});
    throw Error(`Unexpected bundle import: ${specifier}`);
  });
  await module.evaluate();
  assert.equal(typeof handler,'function');
  return {handler,writes};
}
function browserRequest(body={resource:'workspace',method:'GET',body:null},headers={}){
  return new Request('https://example.supabase.co/functions/v1/flight-api',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test-session','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
}
test('dashboard API permits only the configured browser origin',async()=>{
  const {handler,writes}=await load('flight-api');
  assert.equal((await handler(browserRequest(undefined,{Origin:'https://untrusted.example'}))).status,403);
  assert.equal(writes.length,0);
});
test('dashboard API rejects a publishable key without a user session',async()=>{
  const {handler,writes}=await load('flight-api');
  assert.equal((await handler(browserRequest(undefined,{Authorization:'',apikey:'sb_publishable_test'}))).status,401);
  assert.equal(writes.length,0);
});
test('dashboard API rejects an invalid user token',async()=>{
  const {handler}=await load('flight-api',{validToken:false});
  assert.equal((await handler(browserRequest())).status,401);
});
test('dashboard API requires verified email',async()=>{
  const {handler}=await load('flight-api',{verified:false});
  assert.equal((await handler(browserRequest())).status,401);
});
test('dashboard API returns confirmed owner membership for their own workspace',async()=>{
  const {handler}=await load('flight-api');
  const response=await handler(browserRequest());
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.data.account.role,'owner');
  assert.equal(body.data.account.workspace,userId);
});
test('dashboard API rejects cross-workspace access',async()=>{
  const {handler}=await load('flight-api');
  assert.equal((await handler(browserRequest({resource:'workspace',method:'GET',workspace:otherId,body:null}))).status,403);
});
test('dashboard API rejects Viewer writes before accessing the database',async()=>{
  const {handler,writes}=await load('flight-api',{role:'viewer'});
  assert.equal((await handler(browserRequest({resource:'workspace',method:'PUT',body:{settings:{}}}))).status,403);
  assert.equal(writes.length,0);
});
test('dashboard API never sends a live actuator command, even for Owner',async()=>{
  const {handler,writes}=await load('flight-api');
  const command={schemaVersion:1,id:crypto.randomUUID(),aircraftId:'FD-001',environment:'LIVE',kind:'servo.test',parameters:{},expiresAt:Date.now()+5000};
  const response=await handler(browserRequest({resource:'commands',method:'POST',body:command}));
  const envelope=await response.json();
  assert.equal(envelope.status,422);
  assert.equal(envelope.data.sent,false);
  assert.equal(envelope.data.status,'Rejected');
  assert.equal(writes.length,1);
  assert.equal(writes[0].data.payload.sent,false);
});
test('ingest stays closed until a device token is provisioned',async()=>{
  const {handler,writes}=await load('telemetry-ingest');
  const request=new Request('https://example.supabase.co/functions/v1/telemetry-ingest',{method:'POST',body:'{}'});
  assert.equal((await handler(request)).status,401);
  assert.equal(writes.length,0);
});
test('ingest rejects the wrong device token',async()=>{
  const {handler,writes}=await load('telemetry-ingest',{env:{DEVICE_SHARED_TOKEN:'a'.repeat(64)}});
  const request=new Request('https://example.supabase.co/functions/v1/telemetry-ingest',{method:'POST',headers:{'x-device-token':'b'.repeat(64)},body:'{}'});
  assert.equal((await handler(request)).status,401);
  assert.equal(writes.length,0);
});
test('ingest validates telemetry before database access',async()=>{
  const token='a'.repeat(64);
  const {handler,writes}=await load('telemetry-ingest',{env:{DEVICE_SHARED_TOKEN:token}});
  const request=new Request('https://example.supabase.co/functions/v1/telemetry-ingest',{method:'POST',headers:{'x-device-token':token},body:'{}'});
  assert.equal((await handler(request)).status,400);
  assert.equal(writes.length,0);
});

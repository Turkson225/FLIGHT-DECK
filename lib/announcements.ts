import type {Capabilities,Environment,FlightEvent,Frame,Settings} from './flight.ts';
import {checklistComplete,freshFrame,readyForTakeoff,sanitizeSafety} from './safety.ts';

export const voiceCategories={connections:'Connection changes',battery:'Battery warnings',sensors:'IMU health',preflight:'Preflight readiness',failure:'Reported flight failure',parachute:'Parachute status',recording:'Session recording',commands:'Rejected commands'};
export type VoiceCategory=keyof typeof voiceCategories;
export type VoicePreferences={enabled:boolean;voiceURI:string;volume:number;rate:number;categories:Record<VoiceCategory,boolean>};
export const defaultVoice:VoicePreferences={enabled:false,voiceURI:'',volume:.8,rate:1,categories:{connections:true,battery:true,sensors:true,preflight:true,failure:true,parachute:true,recording:true,commands:true}};
export function parseVoice(value:unknown):VoicePreferences {
  const p=value&&typeof value==='object'?value as Partial<VoicePreferences>:{};
  const finite=(v:unknown,min:number,max:number,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
  return {enabled:p.enabled===true,voiceURI:typeof p.voiceURI==='string'?p.voiceURI.slice(0,500):'',volume:finite(p.volume,0,1,.8),rate:finite(p.rate,.7,1.4,1),categories:Object.fromEntries(Object.keys(voiceCategories).map(k=>[k,typeof p.categories?.[k as VoiceCategory]==='boolean'?p.categories[k as VoiceCategory]:true])) as VoicePreferences['categories']};
}
export type VoiceSnapshot={scope:string;environment:Environment;signals:Record<string,string|null>};
export type VoiceNotice={key:string;signal:string;value:string;category:VoiceCategory;text:string;priority:0|1|2;at:number};
export function voiceSnapshot(x:{environment:Environment;frame:Frame;settings:Settings;capabilities:Capabilities|null;now:number;backend:boolean;recording:boolean;latestEvent?:FlightEvent}):VoiceSnapshot {
  const {frame:f,settings:s,environment:env,now}=x,fresh=freshFrame(f,now),safety=fresh?sanitizeSafety(f,x.capabilities):null;
  const health=(v:boolean|null)=>fresh&&v!==null?v?'healthy':'lost':null;
  const battery=(v:number|null,c:Settings['aircraftBattery'])=>fresh&&v!==null?v<c.critical?'critical':v<c.warning?'low':'healthy':null;
  return {scope:`${env}:${s.id}:${f.bootId}`,environment:env,signals:{
    telemetry:f.receivedAt?fresh?'healthy':'lost':null,
    backend:env==='LIVE'?x.backend?'healthy':'lost':null,
    radio:health(f.links.radio),uart:health(f.links.uart),wifi:health(f.links.wifi),imu:health(f.imu),
    aircraftBattery:battery(f.aircraftVoltage,s.aircraftBattery),transmitterBattery:battery(f.transmitterVoltage,s.transmitterBattery),
    failure:safety?.flightFailure===true?'failed':safety?.flightFailure===false?'healthy':null,
    checklist:checklistComplete(s)?'complete':'incomplete',
    ready:(env!=='LIVE'||x.backend)&&readyForTakeoff(f,s,x.capabilities,now)?'ready':null,
    parachute:safety?.parachute?.state??null,
    recording:x.recording?'started':'stopped',
    rejected:x.latestEvent?.title==='Command rejected'?x.latestEvent.id:null
  }};
}
export function voiceTransitions(previous:VoiceSnapshot|null,current:VoiceSnapshot,now:number):VoiceNotice[] {
  if(current.environment==='REPLAY')return [];
  const old=previous?.scope===current.scope?previous.signals:{},out:VoiceNotice[]=[];
  const add=(signal:string,category:VoiceCategory,text:string,priority:0|1|2=1)=>{
    const value=current.signals[signal];if(value===null||value===undefined||value===old[signal])return;
    out.push({key:`${signal}:${value}`,signal,value,category,text:(current.environment==='DEMO'?'Demo. ':'')+text,priority,at:now});
  };
  for(const [key,label] of [['telemetry','Aircraft telemetry connection'],['backend','Dashboard connection'],['radio','Radio link'],['uart','Nano communication'],['wifi','Onboard Wi-Fi']] as const){
    const value=current.signals[key];
    if(value==='lost'&&(old[key]==='healthy'||!['telemetry','backend'].includes(key)))add(key,'connections',`${label} lost.${key==='telemetry'?' Aircraft condition unknown.':''}`,2);
    if(value==='healthy'&&old[key]==='lost')add(key,'connections',`${label} restored.`,0);
  }
  if(current.signals.imu==='lost')add('imu','sensors','IMU unavailable.',2);
  if(current.signals.imu==='healthy'&&old.imu==='lost')add('imu','sensors','IMU data restored.',0);
  for(const [key,label] of [['aircraftBattery','Aircraft'],['transmitterBattery','Transmitter']] as const){
    const value=current.signals[key];
    if(value==='critical'||value==='low')add(key,'battery',`${label} battery ${value}.`,value==='critical'?2:1);
  }
  if(current.signals.failure==='failed')add('failure','failure','Flight failure reported.',2);
  if(current.signals.ready==='ready')add('ready','preflight','Preflight complete. Ready for takeoff.',0);
  else if(current.signals.checklist==='complete')add('checklist','preflight','Operator checklist complete. Aircraft readiness not confirmed.',0);
  const p=current.signals.parachute;
  if(p==='released')add('parachute','parachute','Parachute release reported. Deployment unconfirmed.',2);
  if(p==='deployed')add('parachute','parachute',current.environment==='DEMO'?'Parachute deployed in the simulator.':'Parachute deployment feedback confirmed.',2);
  if(p==='fault')add('parachute','parachute','Parachute system fault.',2);
  if(current.signals.recording==='started')add('recording','recording','Session recording started.',0);
  if(current.signals.recording==='stopped'&&old.recording==='started')add('recording','recording','Session recording stopped.',0);
  if(current.signals.rejected)add('rejected','commands','Command rejected.',1);
  return out.sort((a,b)=>b.priority-a.priority);
}

/** Small expiring queue; never replay old warnings after a browser resumes. */
export class AnnouncementQueue {
  pending:VoiceNotice[]=[];
  current:VoiceNotice|null=null;
  private generation=0;
  private recent=new Map<string,number>();
  private speak:(n:VoiceNotice,done:()=>void)=>void;
  private stop:()=>void;
  private clock:()=>number;
  constructor(speak:(n:VoiceNotice,done:()=>void)=>void,stop:()=>void,clock:()=>number=Date.now){this.speak=speak;this.stop=stop;this.clock=clock;}
  enqueue(items:VoiceNotice[]){
    const now=this.clock();
    for(const n of items){
      if(now-n.at>8000||now-(this.recent.get(n.key)??-Infinity)<15000)continue;
      this.recent.set(n.key,now);
      this.pending=this.pending.filter(p=>p.signal!==n.signal);
      this.pending.push(n);
    }
    this.pending.sort((a,b)=>b.priority-a.priority||a.at-b.at);
    this.pending=this.pending.slice(0,4);
    if(this.current&&this.pending[0]?.priority>this.current.priority)this.cancelCurrent();
    this.pump();
  }
  reconcile(valid:(n:VoiceNotice)=>boolean){
    this.pending=this.pending.filter(n=>valid(n)&&this.clock()-n.at<=8000);
    if(this.current&&(!valid(this.current)||this.clock()-this.current.at>8000))this.cancelCurrent();
    for(const [key,at] of this.recent)if(this.clock()-at>60000)this.recent.delete(key);
    this.pump();
  }
  private cancelCurrent(){this.generation++;this.current=null;this.stop();}
  private pump(){
    if(this.current)return;
    this.pending=this.pending.filter(n=>this.clock()-n.at<=8000);
    const n=this.pending.shift();if(!n)return;
    this.current=n;const generation=++this.generation;
    this.speak(n,()=>{if(generation!==this.generation)return;this.current=null;this.pump();});
  }
  clear(){this.pending=[];this.recent.clear();this.cancelCurrent();}
}

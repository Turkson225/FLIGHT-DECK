'use client';
import {cloudRequest} from '@/lib/supabase';
import {Slider} from '@/components/ui/slider';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {fmt} from '@/lib/flight';
export function Choice({value,onChange,options,label,disabled=false}:{value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];label:string;disabled?:boolean}){return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label}><SelectValue/></SelectTrigger><SelectContent>{options.map(o=><SelectItem value={o.value} key={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>}
export function Pill({children,tone='muted',dot=false}:{children:React.ReactNode;tone?:string;dot?:boolean}){return <span className={`pill ${tone}`}>{dot&&<i className="dot"/>}{children}</span>}
export function Range({label,value,onChange,min=0,max=1,step=.01,disabled=false}:{label:string;value:number;onChange:(v:number)=>void;min?:number;max?:number;step?:number;disabled?:boolean}){return <div className="field"><label>{label}</label><div className="range-row"><Slider aria-label={label} value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={v=>onChange(v[0])}/><span>{fmt(value*100,0)}%</span></div></div>}
export function NumberField({label,value,onChange,min,max,step=1,disabled=false}:{label:string;value:number;onChange:(v:number)=>void;min:number;max:number;step?:number;disabled?:boolean}){return <label className="field">{label}<input type="number" min={min} max={max} step={step} disabled={disabled} value={value} onChange={e=>{const n=e.currentTarget.valueAsNumber;if(Number.isFinite(n)&&n>=min&&n<=max)onChange(n)}}/></label>}
export function download(name:string,text:string,type='application/json'){const u=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
export function apiFetch(path:string,options?:RequestInit){return cloudRequest(path,options)}
export async function apiJson<T>(path:string,options?:RequestInit):Promise<T>{const r=await apiFetch(path,options),d=await r.json() as T&{error?:string};if(!r.ok)throw Error(d.error??'Service unavailable');return d}
export const postOptions=(data:unknown,method='POST'):RequestInit=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});

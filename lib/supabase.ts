import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL?.trim(),key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabase=url&&key?createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}):null;
export const workspaceId=()=>new URLSearchParams(location.search).get('workspace')||import.meta.env.VITE_WORKSPACE_ID||undefined;
export async function cloudRequest(path:string,options?:RequestInit):Promise<Response>{
 const parsed=new URL(path,location.origin),resource=parsed.pathname.split('/').filter(Boolean).at(-1),method=options?.method??'GET';
 if(!supabase){if(resource==='workspace'&&method==='GET')return Response.json({account:{authenticated:false},settings:null,recordings:[]});return Response.json({error:'Supabase is not configured. Open Setup for connection instructions.'},{status:503})}
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){if(resource==='workspace'&&method==='GET')return Response.json({account:{authenticated:false},settings:null,recordings:[]});return Response.json({error:'Sign in to access protected aircraft data.'},{status:401})}
 const {data,error}=await supabase.functions.invoke('flight-api',{body:{resource,method,query:Object.fromEntries(parsed.searchParams),workspace:workspaceId(),body:typeof options?.body==='string'?JSON.parse(options.body):null},signal:options?.signal??undefined});
 if(error){let detail='Cloud request failed. Check the Supabase deployment and your connection.';if(error.context instanceof Response){try{detail=(await error.context.json()).error??detail}catch{}}return Response.json({error:detail},{status:503})}
 return Response.json(data?.data??{}, {status:data?.status??200});
}

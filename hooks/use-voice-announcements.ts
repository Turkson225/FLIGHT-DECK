import {useEffect,useRef,useState} from 'react';
import {AnnouncementQueue,defaultVoice,parseVoice,voiceTransitions} from '../lib/announcements';
import type {VoiceNotice,VoicePreferences,VoiceSnapshot} from '../lib/announcements';

const storageKey='flightdeck-voice-v1';
export function useVoiceAnnouncements(snapshot:VoiceSnapshot){
  const [preferences,setPreferences]=useState<VoicePreferences>(()=>{try{return parseVoice(JSON.parse(localStorage.getItem(storageKey)??'null'));}catch{return structuredClone(defaultVoice);}});
  const [active,setActive]=useState(false),[supported,setSupported]=useState(false),[voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const [last,setLast]=useState<VoiceNotice|null>(null),[history,setHistory]=useState<VoiceNotice[]>([]),[error,setError]=useState('');
  const pref=useRef(preferences);pref.current=preferences;
  const queue=useRef<AnnouncementQueue|null>(null),previous=useRef<VoiceSnapshot|null>(null);
  useEffect(()=>{
    if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return;
    setSupported(true);
    const speech=window.speechSynthesis;
    const refresh=()=>setVoices(speech.getVoices());refresh();speech.addEventListener('voiceschanged',refresh);
    queue.current=new AnnouncementQueue((n,done)=>{
      const p=pref.current,utterance=new SpeechSynthesisUtterance(n.text);
      utterance.voice=speech.getVoices().find(v=>v.voiceURI===p.voiceURI)??null;
      utterance.lang=utterance.voice?.lang??'en-US';utterance.volume=p.volume;utterance.rate=p.rate;
      utterance.onstart=()=>setError('');utterance.onend=done;
      utterance.onerror=e=>{if(!['canceled','interrupted'].includes(e.error))setError(`Voice unavailable (${e.error}). Use the visible alerts.`);done();};
      setLast(n);setHistory(h=>[n,...h].slice(0,8));
      try{speech.speak(utterance);}catch{setError('This browser could not play speech. Use the visible alerts.');done();}
    },()=>speech.cancel());
    return()=>{queue.current?.clear();queue.current=null;speech.removeEventListener('voiceschanged',refresh);};
  },[]);
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(preferences));}catch{setError('Voice preferences could not be saved in this browser.');}},[preferences]);
  useEffect(()=>{
    const changed=previous.current?.scope!==snapshot.scope;
    if(changed){queue.current?.clear();setLast(null);setHistory([]);}
    const notices=voiceTransitions(previous.current,snapshot,Date.now());previous.current=snapshot;
    if(!active||!preferences.enabled||snapshot.environment==='REPLAY'){
      // An explicit preview may play while muted or in replay. Automatic speech cannot.
      queue.current?.reconcile(n=>n.signal==='preview');return;
    }
    queue.current?.reconcile(n=>n.signal==='preview'||(preferences.categories[n.category]&&snapshot.signals[n.signal]===n.value));
    queue.current?.enqueue(notices.filter(n=>preferences.categories[n.category]));
  },[snapshot,active,preferences]);
  function preview(text='Voice announcements are available. This is a browser voice preview.'){
    if(!supported)return;
    queue.current?.clear();setError('');
    queue.current?.enqueue([{key:'preview',signal:'preview',value:'preview',category:'preflight',text:'Voice preview. '+text,priority:0,at:Date.now()}]);
  }
  function enable(){setActive(true);setPreferences(p=>({...p,enabled:true}));preview('Voice announcements enabled. Keep this dashboard open.');}
  function mute(){setActive(false);setPreferences(p=>({...p,enabled:false}));queue.current?.clear();}
  function update(p:Partial<VoicePreferences>){queue.current?.clear();setPreferences(old=>parseVoice({...old,...p}));}
  return {preferences,update,active:active&&preferences.enabled,supported,voices,last,history,error,enable,mute,preview,stop:()=>queue.current?.clear()};
}
export type VoiceController=ReturnType<typeof useVoiceAnnouncements>;

import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('supabase/functions/_shared',{recursive:true});
for(const file of ['contracts.ts','flight.ts','modes.ts','safety.ts'])writeFileSync('supabase/functions/_shared/'+file,readFileSync('lib/'+file,'utf8').replace("from 'zod'","from 'npm:zod@3.25.76'"));

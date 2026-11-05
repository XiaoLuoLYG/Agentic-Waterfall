import {mkdirSync,rmdirSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {openLedger} from './ledger-store.mjs';

const file=process.argv[2],lock=file+'.export.lock';
mkdirSync(lock);writeFileSync(lock+'/pid',String(process.pid));
const store=openLedger(file);if(!store)throw Error('sqlite_ledger_not_enabled');
let running=true;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{running=false;});
try{while(running){await store.exportSnapshot();await delay(1000);}await store.exportSnapshot();}
finally{store.close();(await import('node:fs')).unlinkSync(lock+'/pid');rmdirSync(lock);}

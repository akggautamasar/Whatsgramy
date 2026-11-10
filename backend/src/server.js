import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
import { Store } from './store.js';
import { Archive } from './archive.js';
import { TelegramArchive } from './telegram.js';
import { WhatsAppConnection } from './whatsapp.js';
import { recoverArchive } from './metadata.js';
import { createApp } from './http.js';
process.umask(0o077);
const cfg=config();await mkdir(cfg.dir,{recursive:true,mode:0o700});const store=new Store(join(cfg.dir,'archive.sqlite'));const tg=new TelegramArchive(cfg);await tg.connect().catch(()=>console.error('Telegram connection unavailable; pending files will be retained.'));const wa=new WhatsAppConnection({dir:cfg.dir,store});const archive=new Archive({store,telegram:tg,download:(...args)=>wa.download(...args),dir:join(cfg.dir,'media'),indexKey:cfg.indexKey,indexMode:cfg.indexMode});
let recoveryBlocked=false;if(tg.authorized){try{await recoverArchive(store,tg,cfg.indexKey);}catch{recoveryBlocked=true;console.error("Archive recovery needs attention; capture is paused to avoid replacing an unreadable index.");}}
const server=createApp({store,archive,wa,tg,token:cfg.token}).listen(cfg.port,cfg.host,()=>console.log(`Whatsgramy listening on ${cfg.host}:${cfg.port}`));
if(!recoveryBlocked)await wa.start().catch(()=>console.error('WhatsApp connection unavailable; use Connect in the app.'));
const timer=setInterval(()=>{if(recoveryBlocked)return;archive.tick().catch(()=>console.error('Archive paused after an error; pending files retained.'));},5000);
let closing=false;for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{if(closing)return;closing=true;clearInterval(timer);server.close();await wa.stop();while(archive.running)await new Promise(r=>setTimeout(r,100));await tg.close();store.close();process.exit(0);});

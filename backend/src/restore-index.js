import { config } from './config.js';
import { Store } from './store.js';
import { TelegramArchive } from './telegram.js';
import { recoverArchive } from './metadata.js';
import { join } from 'node:path';
const cfg=config(),tg=new TelegramArchive(cfg);let store;
try{await tg.connect();store=new Store(join(cfg.dir,'archive.sqlite'));const result=await recoverArchive(store,tg,cfg.indexKey,{force:true});console.log(`Recovery: ${result.status}; ${result.restored} attachment records read. No local files deleted.`);}finally{store?.close();await tg.close();}

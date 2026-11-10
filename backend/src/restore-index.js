import { config } from './config.js';
import { Store } from './store.js';
import { TelegramArchive } from './telegram.js';
import { unseal } from './archive.js';
import { join } from 'node:path';
const cfg=config(),tg=new TelegramArchive(cfg);let store;
try{await tg.connect();const records=await tg.ready().getMessages(cfg.destination,{search:'#whatsgramy-index-v1',limit:20});const latest=records.find(m=>m.message==='#whatsgramy-index-v1'&&m.media);if(!latest)throw Error('No index backup found');const bytes=await tg.ready().downloadMedia(latest);const snapshot=unseal(bytes,cfg.indexKey);store=new Store(join(cfg.dir,'archive.sqlite'));store.restore(snapshot);console.log(`Restored ${snapshot.media.length} archived attachments. No local media files were deleted.`);}finally{store?.close();await tg.close();}

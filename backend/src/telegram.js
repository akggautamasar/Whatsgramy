import { TelegramClient } from 'telegram';
import { CustomFile } from 'telegram/client/uploads.js';
import { StringSession } from 'telegram/sessions/index.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
export class TelegramArchive {
 constructor(cfg){this.cfg=cfg;this.client=null;this.authorized=false;}
 async connect(){if(!this.cfg.apiId||!this.cfg.apiHash)return;const session=await readFile(join(this.cfg.dir,'telegram.session'),'utf8').catch(()=>'');if(!session)return;this.client=new TelegramClient(new StringSession(session.trim()),this.cfg.apiId,this.cfg.apiHash,{connectionRetries:3});this.client.setLogLevel('none');await this.client.connect();this.authorized=await this.client.isUserAuthorized();}
 ready(){if(!this.authorized)throw Error('Connect Telegram on the server: npm run telegram:login');return this.client;}
 async upload(path,m){const c=this.ready();const caption=`wg:${m.id}`;const old=await c.getMessages(this.cfg.destination,{search:caption,limit:5});const found=old.find(x=>x.message===caption&&x.media);if(found)return found.id;const sent=await c.sendFile(this.cfg.destination,{file:new CustomFile(m.name,m.size,path),forceDocument:true,caption,workers:1});return sent.id;}
 async download(id,path){const c=this.ready();const [m]=await c.getMessages(this.cfg.destination,{ids:[id]});if(!m?.media)throw Error('Telegram backup no longer exists');await c.downloadMedia(m,{outputFile:path});}
 async backupIndex(bytes){await this.ready().sendFile(this.cfg.destination,{file:bytes,forceDocument:true,caption:'#whatsgramy-index-v1',attributes:[],workers:1});}
 async close(){await this.client?.disconnect();}
}

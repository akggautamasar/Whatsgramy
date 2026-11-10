import { TelegramClient,Api } from 'telegram';
import bigInt from 'big-integer';
import { CustomFile } from 'telegram/client/uploads.js';
import { StringSession } from 'telegram/sessions/index.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const MARKER='#whatsgramy-index-v2';
export class TelegramArchive {
 constructor(cfg){this.cfg=cfg;this.client=null;this.authorized=false;this.accountId=null;}
 async connect(){if(!this.cfg.apiId||!this.cfg.apiHash)return;const session=await readFile(join(this.cfg.dir,'telegram.session'),'utf8').catch(()=>'');if(!session)return;this.client=new TelegramClient(new StringSession(session.trim()),this.cfg.apiId,this.cfg.apiHash,{connectionRetries:3});this.client.setLogLevel('none');await this.client.connect();this.authorized=await this.client.isUserAuthorized();if(this.authorized)this.accountId=String((await this.client.getMe()).id);}
 ready(){if(!this.authorized)throw Error('Connect Telegram on the server: npm run telegram:login');return this.client;}
 async peer(reference){
  const c=this.ready();if(!reference)return c.getInputEntity(this.cfg.destination);
  if(!reference.startsWith('{'))return c.getInputEntity(reference);
  const p=JSON.parse(reference);if(p.type==='self')return new Api.InputPeerSelf();
  if(p.type==='channel')return new Api.InputPeerChannel({channelId:bigInt(p.id),accessHash:bigInt(p.accessHash)});
  if(p.type==='user')return new Api.InputPeerUser({userId:bigInt(p.id),accessHash:bigInt(p.accessHash)});
  if(p.type==='chat')return new Api.InputPeerChat({chatId:bigInt(p.id)});
  throw Error('Unknown Telegram archive destination');
 }
 describePeer(p){if(p instanceof Api.InputPeerSelf)return JSON.stringify({type:'self'});if(p instanceof Api.InputPeerChannel)return JSON.stringify({type:'channel',id:String(p.channelId),accessHash:String(p.accessHash)});if(p instanceof Api.InputPeerUser)return JSON.stringify({type:'user',id:String(p.userId),accessHash:String(p.accessHash)});if(p instanceof Api.InputPeerChat)return JSON.stringify({type:'chat',id:String(p.chatId)});throw Error('Unsupported Telegram destination');}
 async upload(path,m){const c=this.ready(),peer=await this.peer(),caption=`wg:${m.id}`;const old=await c.getMessages(peer,{search:caption,limit:5});const found=old.find(x=>x.message===caption&&x.media);if(found)return {id:found.id,peer:this.describePeer(peer)};const sent=await c.sendFile(peer,{file:new CustomFile(m.name,m.size,path),forceDocument:true,caption,workers:1});return {id:sent.id,peer:this.describePeer(peer)};}
 async download(id,path,reference){const c=this.ready(),peer=await this.peer(reference);const [m]=await c.getMessages(peer,{ids:[id]});if(!m?.media)throw Error('Telegram backup no longer exists');await c.downloadMedia(m,{outputFile:path});}
 async backupIndex(bytes){const encrypted=bytes[0]!==123;const file=new CustomFile(encrypted?'whatsgramy-manifest.enc':'whatsgramy-manifest.json',bytes.length,'',bytes);const sent=await this.ready().sendFile('me',{file,forceDocument:true,caption:MARKER,workers:1});return sent.id;}
 async *readManifests(){
  const c=this.ready();const sources=['me'];if(this.cfg.destination!=='me')sources.push(this.cfg.destination);
  const candidates=[];
  for(const source of sources){let records;try{records=await c.getMessages(source,{search:'#whatsgramy-index',limit:30});}catch(e){if(source==='me')throw e;continue;}
   for(const m of records)if(m.media&&[MARKER,'#whatsgramy-index-v1'].includes(m.message))candidates.push(m);
  }
  candidates.sort((a,b)=>Number(b.date)-Number(a.date)||b.id-a.id);
  for(const m of candidates)yield {id:m.id,download:()=>c.downloadMedia(m)};
 }
 async close(){await this.client?.disconnect();}
}

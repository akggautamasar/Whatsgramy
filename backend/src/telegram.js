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
 ready(){if(!this.authorized)throw Error('Connect Telegram in Settings');return this.client;}
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
 async upload(path, media, onProgress = () => {}, signal) {
  const client = this.ready();
  const peer = await this.peer();
  signal?.throwIfAborted();
  const caption = `wg:${media.id}`;
  const recent = await client.getMessages(peer, {search: caption, limit: 5});
  signal?.throwIfAborted();
  const existing = recent.find(message => message.message === caption && message.media);
  if (existing) return {id: existing.id, peer: this.describePeer(peer)};

  const progress = fraction => onProgress(Number(fraction) * media.size, media.size);
  Object.defineProperty(progress, 'isCanceled', {get: () => !!signal?.aborted});
  const file = await client.uploadFile({file: new CustomFile(media.name, media.size, path), workers: 1, onProgress: progress});
  signal?.throwIfAborted();
  const sent = await client.sendFile(peer, {
   file, caption, forceDocument: true, mimeType: media.mime,
   attributes: [new Api.DocumentAttributeFilename({fileName: media.name})],
  });
  return {id: sent.id, peer: this.describePeer(peer)};
 }
 async download(id, path, reference, onProgress = () => {}, signal) {
  const client = this.ready();
  const peer = await this.peer(reference);
  signal?.throwIfAborted();
  const [message] = await client.getMessages(peer, {ids: [id]});
  signal?.throwIfAborted();
  if (!message?.media) throw Error('Telegram backup no longer exists');
  await client.downloadMedia(message, {
   outputFile: path,
   progressCallback: (bytes, total) => {
    signal?.throwIfAborted();
    onProgress(Number(bytes), Number(total));
   },
  });
 }
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

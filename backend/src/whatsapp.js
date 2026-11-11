import makeWASocket, { useMultiFileAuthState, downloadMediaMessage, normalizeMessageContent, BufferJSON, DisconnectReason, jidNormalizedUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { setImmediate as yieldToRequests } from 'node:timers/promises';
import { pipeline } from 'node:stream/promises';
import { mediaId } from './archive.js';
export function classify(message){
 if(!message||message.viewOnceMessage||message.viewOnceMessageV2||message.viewOnceMessageV2Extension||message.ephemeralMessage)return null;
 const value=normalizeMessageContent(message);if(!value)return null;
 const type=['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'].find(k=>value[k]);
 if(!type)return null;const body=value[type];if(body.viewOnce)return null;
 return {body,mime:body.mimetype||'application/octet-stream',kind:type==='imageMessage'?'photos':type==='videoMessage'?'videos':type==='audioMessage'?'audio':type==='documentMessage'?'documents':'other',name:body.fileName||`${type.replace('Message','')}.${type==='imageMessage'?'jpg':type==='videoMessage'?'mp4':type==='audioMessage'?'ogg':type==='stickerMessage'?'webp':'bin'}`};
}
export function attachmentHash(message) {
 const value = classify(message)?.body.fileSha256;
 if (value instanceof Uint8Array && value.length === 32) return Buffer.from(value).toString('hex');
 if (typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)) return Buffer.from(value,'base64').toString('hex');
 return null;
}

export class WhatsAppConnection {
 constructor({dir,store,includeSent=false}){this.dir=dir;this.store=store;this.includeSent=includeSent;this.socket=null;this.connection='disconnected';this.qr=null;this.timer=null;this.stopping=false;this.starting=null;}
 async start(){if(this.socket||this.starting)return this.starting;this.stopping=false;this.starting=this.connect().finally(()=>{this.starting=null;});return this.starting;}
 async connect(){const {state,saveCreds}=await useMultiFileAuthState(join(this.dir,'whatsapp-session'));const socket=makeWASocket({auth:state,logger:pino({level:'silent'}),markOnlineOnConnect:false,syncFullHistory:true,getMessage:async()=>undefined});this.socket=socket;this.connection='connecting';socket.ev.on('creds.update',saveCreds);
 socket.ev.on('connection.update',async update=>{if(this.socket!==socket)return;if(update.qr)this.qr=await QRCode.toDataURL(update.qr,{width:512,margin:2});if(update.connection){this.connection=update.connection;if(update.connection==='open')this.qr=null;if(update.connection==='close'){this.socket=null;const code=update.lastDisconnect?.error?.output?.statusCode;if(code===DisconnectReason.loggedOut){this.connection='logged_out';this.qr=null;}else if(!this.stopping){clearTimeout(this.timer);this.timer=setTimeout(()=>this.start().catch(()=>{}),5000);}}}});
 const saveBatch = ({chats = [], messages = []}) => {
  const account = socket.user?.id;
  void this.ingestBatch(chats, messages, account, () => this.socket === socket)
    .catch(error => console.warn('WhatsApp history could not be indexed:', error.message));
 };
 socket.ev.on('chats.upsert', chats => saveBatch({chats}));
 socket.ev.on('messaging-history.set', saveBatch);
 socket.ev.on('messages.upsert', saveBatch);
 }
 async ingestBatch(chats, messages, account, active = () => true) {
  // Commit small chunks so the archive API and transfers can run during history sync.
  for (let offset = 0; offset < chats.length && active(); offset += 40) {
   this.store.batch(() => {
    for (const chat of chats.slice(offset, offset + 40)) {
     if (chat.id) this.store.chat(chat.id, chat.name || chat.subject || chat.id);
    }
   });
   await yieldToRequests();
  }
  for (let offset = 0; offset < messages.length && active(); offset += 40) {
   this.store.batch(() => {
    for (const message of messages.slice(offset, offset + 40)) this.ingest(message, account);
   });
   await yieldToRequests();
  }
 }
 ingest(m, userId = this.socket?.user?.id){if(!userId||!m.key?.id||!m.key.remoteJid||m.key.remoteJid==='status@broadcast'||!m.message)return;const chat=m.key.remoteJid,account=jidNormalizedUser(userId),id=mediaId(account,chat,m.key.id);const media=classify(m.message);const indexMedia=media&&(!m.key.fromMe||this.includeSent);const content=normalizeMessageContent(m.message);const timestamp=Number(m.messageTimestamp||Math.floor(Date.now()/1000))*1000;
  const existing=this.store.db.prepare('SELECT title FROM chats WHERE id=?').get(chat);this.store.chat(chat,existing?.title||m.pushName||chat,timestamp);
  if(m.message.ephemeralMessage||m.message.viewOnceMessage||m.message.viewOnceMessageV2||m.message.viewOnceMessageV2Extension)return;
  const text=content?.conversation||content?.extendedTextMessage?.text||media?.body.caption||'';this.store.message({id,chatId:chat,sender:m.pushName||m.key.participant||chat,text,timestamp,mediaId:indexMedia?id:null,fromMe:!!m.key.fromMe});
  if(indexMedia)this.store.insertMedia({id,chatId:chat,messageId:m.key.id,name:media.name,mime:media.mime,kind:media.kind,size:Number(media.body.fileLength||0),expectedSha:attachmentHash(m.message),raw:JSON.stringify(m,BufferJSON.replacer)});
 }
 expectedHash(raw) {
  if (!raw) return null;
  try { return attachmentHash(JSON.parse(raw, BufferJSON.reviver).message); }
  catch { return null; }
 }
 async pair(phone){if(!/^\d{8,15}$/.test(phone))throw Error('Enter country code and number using digits only');await this.start();if(this.socket.authState.creds.registered)throw Error('WhatsApp is already linked');await new Promise(r=>setTimeout(r,1500));return this.socket.requestPairingCode(phone);}
 async download(m, path, maxBytes, onProgress = () => {}, signal) {
  const socket = this.socket;
  if (this.connection !== 'open' || !socket) throw Error('WhatsApp linked device is offline');
  const raw = JSON.parse(m.raw, BufferJSON.reviver);
  const stream = await downloadMediaMessage(raw, 'stream', {}, {
   logger: pino({level: 'silent'}),
   reuploadRequest: async message => {
    signal?.throwIfAborted();
    const reconnect = () => {
     if (this.socket === socket) socket.end(Error('WhatsApp media refresh timed out'));
    };
    signal?.addEventListener('abort', reconnect, {once: true});
    try {
     const updated = await socket.updateMediaMessage(message);
     signal?.throwIfAborted();
     return updated;
    } finally {
     signal?.removeEventListener('abort', reconnect);
    }
   },
  });
  if (signal?.aborted) {
   stream.destroy();
   signal.throwIfAborted();
  }
  let bytes = 0;
  const limit = new Transform({
   transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(Error('Attachment exceeds upload limit'));
    onProgress(bytes, m.size);
    callback(null, chunk);
   },
  });
  await pipeline(stream, limit, createWriteStream(path, {mode: 0o600}), {signal});
 }
 async stop(){this.stopping=true;clearTimeout(this.timer);const s=this.socket;this.socket=null;this.connection='disconnected';s?.end(undefined);}
}

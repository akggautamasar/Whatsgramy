import makeWASocket, { useMultiFileAuthState, downloadMediaMessage, normalizeMessageContent, BufferJSON, DisconnectReason, jidNormalizedUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { setImmediate as yieldToRequests, setTimeout as delay } from 'node:timers/promises';
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
 constructor({dir,store,includeSent=false}){this.dir=dir;this.store=store;this.includeSent=includeSent;this.socket=null;this.connection='disconnected';this.qr=null;this.timer=null;this.stopping=false;this.starting=null;this.pairing=false;this.readyToPair=false;this.savedCredentials=Promise.resolve();}
 async start(){if(this.socket||this.starting)return this.starting;this.stopping=false;clearTimeout(this.timer);this.starting=this.savedCredentials.then(()=>this.connect()).finally(()=>{this.starting=null;});return this.starting;}
 async connect(){const {state,saveCreds}=await useMultiFileAuthState(join(this.dir,'whatsapp-session'));const socket=makeWASocket({auth:state,logger:pino({level:'silent'}),markOnlineOnConnect:false,syncFullHistory:true,getMessage:async()=>undefined});this.socket=socket;
 this.connection='connecting';
 this.readyToPair=false;
 this.qr=null;
 socket.ev.on('creds.update', () => {
  if (this.socket === socket) this.savedCredentials = this.savedCredentials.then(saveCreds).catch(() => {});
 });
 socket.ev.on('connection.update', async update => {
  if (this.socket !== socket) return;
  if (update.connection === 'close') {
   this.socket = null;
   this.readyToPair = false;
   this.qr = null;
   const code = update.lastDisconnect?.error?.output?.statusCode;
   this.connection = code === DisconnectReason.loggedOut ? 'logged_out' : 'disconnected';
   if (this.connection !== 'logged_out' && !this.stopping && !this.pairing) {
    this.timer = setTimeout(() => this.start().catch(() => {}), 5000);
   }
   if (code === DisconnectReason.restartRequired && !this.stopping && this.pairing) {
    this.timer = setTimeout(() => this.start().catch(() => {}), 500);
   }
   return;
  }
  if (update.connection) this.connection = update.connection;
  if (update.connection === 'open' || update.isNewLogin) {
   this.readyToPair = false;
   this.qr = null;
  }
  if (update.qr) {
   this.readyToPair = true;
   const image = await QRCode.toDataURL(update.qr, {width:512, margin:2});
   if (this.socket === socket && this.readyToPair) this.qr = image;
  }
 });
 const saveContacts = contacts => {
  if (this.socket !== socket) return;
  for (const contact of contacts ?? []) {
   const phone = contact.phoneNumber || (contact.id?.endsWith('@s.whatsapp.net') ? contact.id : null);
   for (const id of new Set([contact.id, contact.lid, phone])) {
    if (id) this.store.chatIdentity(id, phone, contact.name || contact.notify || contact.verifiedName);
   }
  }
 };
 socket.ev.on('contacts.upsert', saveContacts);
 socket.ev.on('contacts.update', saveContacts);
 socket.ev.on('lid-mapping.update', ({lid,pn}) => {
  if (this.socket === socket) this.store.chatIdentity(lid, pn);
 });
 const saveBatch = ({chats = [], messages = [], contacts = []}) => {
  saveContacts(contacts);
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
  if (m.key.remoteJidAlt) {
   this.store.chatIdentity(chat, m.key.remoteJidAlt);
   this.store.chatIdentity(m.key.remoteJidAlt, chat);
  }
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
 async resetPairing() {
  await this.stop();
  await this.savedCredentials;
  await rm(join(this.dir,'whatsapp-session'), {recursive:true, force:true});
  this.readyToPair = false;
  this.qr = null;
 }
 async startQr() {
  if (this.pairing) throw Error('A pairing code is already being requested');
  this.pairing = true;
  try {
   if (this.connection === 'logged_out' ||
       (this.socket && !this.socket.authState.creds.registered && this.socket.authState.creds.pairingCode)) {
    await this.resetPairing();
   }
   await this.start();
  } finally {
   this.pairing = false;
  }
 }
 async pair(phone) {
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw Error('Enter the WhatsApp number including its country code');
  if (this.pairing) throw Error('A pairing code is already being requested');
  this.pairing = true;
  try {
   if (this.connection === 'logged_out') await this.resetPairing();
   await this.start();
   if (this.socket?.authState.creds.registered) {
    throw Error(this.connection === 'open' ? 'WhatsApp is already linked' : 'Wait for WhatsApp to reconnect, then try again if it reports a logout');
   }
   if (this.socket?.authState.creds.pairingCode) {
    await this.resetPairing();
    await this.start();
   }
   const socket = this.socket;
   const deadline = Date.now() + 20000;
   while (socket && this.socket === socket && !this.readyToPair && Date.now() < deadline) await delay(100);
   if (!socket || this.socket !== socket || !this.readyToPair) {
    throw Error('WhatsApp did not finish connecting. Check your connection and request a new code.');
   }
   try {
    return await socket.requestPairingCode(phone);
   } catch {
    throw Error('WhatsApp could not request a pairing code. Try again or use the QR code.');
   }
  } finally {
   this.pairing = false;
  }
 }
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

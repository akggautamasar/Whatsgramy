import makeWASocket, { useMultiFileAuthState, downloadMediaMessage, normalizeMessageContent, BufferJSON, DisconnectReason, jidNormalizedUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mediaId } from './archive.js';
export function classify(message){
 if(!message||message.viewOnceMessage||message.viewOnceMessageV2||message.viewOnceMessageV2Extension||message.ephemeralMessage)return null;
 const value=normalizeMessageContent(message);if(!value)return null;
 const type=['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'].find(k=>value[k]);
 if(!type)return null;const body=value[type];if(body.viewOnce)return null;
 return {body,mime:body.mimetype||'application/octet-stream',kind:type==='imageMessage'?'photos':type==='videoMessage'?'videos':type==='audioMessage'?'audio':type==='documentMessage'?'documents':'other',name:body.fileName||`${type.replace('Message','')}.${type==='imageMessage'?'jpg':type==='videoMessage'?'mp4':type==='audioMessage'?'ogg':type==='stickerMessage'?'webp':'bin'}`};
}
export class WhatsAppConnection {
 constructor({dir,store}){this.dir=dir;this.store=store;this.socket=null;this.connection='disconnected';this.qr=null;this.timer=null;this.stopping=false;this.starting=null;}
 async start(){if(this.socket||this.starting)return this.starting;this.stopping=false;this.starting=this.connect().finally(()=>{this.starting=null;});return this.starting;}
 async connect(){const {state,saveCreds}=await useMultiFileAuthState(join(this.dir,'whatsapp-session'));const socket=makeWASocket({auth:state,logger:pino({level:'silent'}),markOnlineOnConnect:false,syncFullHistory:true,getMessage:async()=>undefined});this.socket=socket;this.connection='connecting';socket.ev.on('creds.update',saveCreds);
 socket.ev.on('connection.update',async update=>{if(this.socket!==socket)return;if(update.qr)this.qr=await QRCode.toDataURL(update.qr,{width:512,margin:2});if(update.connection){this.connection=update.connection;if(update.connection==='open')this.qr=null;if(update.connection==='close'){this.socket=null;const code=update.lastDisconnect?.error?.output?.statusCode;if(code===DisconnectReason.loggedOut){this.connection='logged_out';this.qr=null;}else if(!this.stopping){clearTimeout(this.timer);this.timer=setTimeout(()=>this.start().catch(()=>{}),5000);}}}});
 socket.ev.on('chats.upsert',chats=>{for(const c of chats)this.store.chat(c.id,c.name||c.subject||c.id);});
 socket.ev.on('messaging-history.set',({chats,messages})=>{for(const c of chats)this.store.chat(c.id,c.name||c.subject||c.id);for(const m of messages)this.ingest(m);});
 socket.ev.on('messages.upsert',({messages})=>{for(const m of messages)this.ingest(m);});
 }
 ingest(m){if(!this.socket?.user?.id||!m.key?.id||!m.key.remoteJid||m.key.remoteJid==='status@broadcast'||!m.message)return;const chat=m.key.remoteJid,account=jidNormalizedUser(this.socket.user.id),id=mediaId(account,chat,m.key.id);const media=classify(m.message);const content=normalizeMessageContent(m.message);const timestamp=Number(m.messageTimestamp||Math.floor(Date.now()/1000))*1000;
  const existing=this.store.db.prepare('SELECT title FROM chats WHERE id=?').get(chat);this.store.chat(chat,existing?.title||m.pushName||chat,timestamp);
  if(m.message.ephemeralMessage||m.message.viewOnceMessage||m.message.viewOnceMessageV2||m.message.viewOnceMessageV2Extension)return;
  const text=content?.conversation||content?.extendedTextMessage?.text||media?.body.caption||'';this.store.message({id,chatId:chat,sender:m.pushName||m.key.participant||chat,text,timestamp,mediaId:media&&!m.key.fromMe?id:null,fromMe:!!m.key.fromMe});
  if(media&&!m.key.fromMe)this.store.insertMedia({id,chatId:chat,messageId:m.key.id,name:media.name,mime:media.mime,kind:media.kind,size:Number(media.body.fileLength||0),raw:JSON.stringify(m,BufferJSON.replacer)});
 }
 async pair(phone){if(!/^\d{8,15}$/.test(phone))throw Error('Enter country code and number using digits only');await this.start();if(this.socket.authState.creds.registered)throw Error('WhatsApp is already linked');await new Promise(r=>setTimeout(r,1500));return this.socket.requestPairingCode(phone);}
 async download(m,path,maxBytes,onProgress=()=>{}){if(this.connection!=='open'||!this.socket)throw Error('WhatsApp linked device is offline');const raw=JSON.parse(m.raw,BufferJSON.reviver);const stream=await downloadMediaMessage(raw,'stream',{}, {logger:pino({level:'silent'}),reuploadRequest:this.socket.updateMediaMessage});let bytes=0;const limit=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;onProgress(bytes,m.size);if(bytes>maxBytes)callback(Error('Attachment exceeds upload limit'));else callback(null,chunk);}});await pipeline(stream,limit,createWriteStream(path,{mode:0o600}));}
 async stop(){this.stopping=true;clearTimeout(this.timer);const s=this.socket;this.socket=null;this.connection='disconnected';s?.end(undefined);}
}

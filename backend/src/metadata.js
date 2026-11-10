import { randomBytes,createCipheriv,createDecipheriv } from 'node:crypto';
import { validateSnapshot } from './store.js';
export function seal(value,key){if(!key||key.length!==32)throw Error('A 32-byte recovery key is required for encrypted metadata');const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);const body=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),body]);}
export function unseal(value,key){if(!key||key.length!==32)throw Error('This backup requires its original INDEX_KEY');const d=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));d.setAuthTag(value.subarray(12,28));return JSON.parse(Buffer.concat([d.update(value.subarray(28)),d.final()]).toString());}
export function encodeSnapshot(snapshot,{mode='telegram',key}={}){validateSnapshot(snapshot);return mode==='encrypted'?seal(snapshot,key):Buffer.from(JSON.stringify(snapshot));}
export function decodeSnapshot(bytes,key){const first=bytes.toString('utf8',0,1);const snapshot=first==='{'?JSON.parse(bytes.toString('utf8')):unseal(bytes,key);return validateSnapshot(snapshot);}
export async function recoverArchive(store,telegram,key,{force=false}={}){
 try{if(telegram.accountId)store.bindTelegramAccount(telegram.accountId);}catch(e){store.recovery('error',e.message);throw e;}
 if(!force&&store.syncState().recovery_status!=='error'&&store.stats().total>0){store.recovery('existing');return {restored:0,status:'existing'};}
 store.recovery('checking');let found=false;let lastError;
 try{
  for await(const candidate of telegram.readManifests()){
   found=true;
   try{
    const bytes=await candidate.download();const snapshot=decodeSnapshot(bytes,key);
    if(snapshot.telegramAccountId&&String(snapshot.telegramAccountId)!==String(telegram.accountId))throw Error('Recovery index belongs to a different Telegram account');
    store.restore(snapshot);return {restored:snapshot.media.length,status:'restored',createdAt:snapshot.createdAt};
   }catch(e){lastError=e;}
  }
  if(found)throw Error(`No readable recovery index: ${lastError?.message||'invalid metadata'}. Keep the original recovery key for encrypted backups.`);
  store.recovery('not_found');return {restored:0,status:'not_found'};
 }catch(e){store.recovery('error',String(e.message).slice(0,250));throw e;}
}

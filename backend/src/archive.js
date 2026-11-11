import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, rename, writeFile, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
export async function hashFile(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
export const mediaId=(account,chat,id)=>createHash('sha256').update(JSON.stringify([account,chat,id])).digest('hex');
export { seal,unseal } from './metadata.js';
import { encodeSnapshot } from './metadata.js';
const exists=async p=>!!p&&await stat(p).then(s=>s.isFile()).catch(()=>false);
export class Archive {
 constructor({store,telegram,download,dir,indexKey,indexMode='encrypted',maxBytes=2_000_000_000, batchSize=100, idleTimeoutMs=60000, backgroundCheckpoints=false}){Object.assign(this,{store,telegram,download,dir,indexKey,indexMode,maxBytes,batchSize,idleTimeoutMs,backgroundCheckpoints});this.locks=new Map();this.running=false;this.manifestLock=null;this.transfers=new Map();}
 progress(id,phase,done=0,total=0){this.transfers.set(id,{phase,bytes:done,total,percent:total>0&&phase!=='verifying'?Math.min(100,Math.round(done/total*100)):null,updated_at:Date.now()});}
 async transfer(id, phase, total, operation, temporaryPath) {
  const controller = new AbortController();
  const {signal} = controller;
  let timer;
  let lastBytes = -1;
  let rejectTimeout;
  const timeout = new Promise((_, reject) => { rejectTimeout = reject; });
  const progress = (bytes, size = total) => {
   signal.throwIfAborted();
   this.progress(id, phase, bytes, size);
   if (bytes <= lastBytes) return;
   lastBytes = bytes;
   clearTimeout(timer);
   timer = setTimeout(() => {
    const error = Error(`${phase[0].toUpperCase()}${phase.slice(1)} stalled. Will retry automatically.`);
    controller.abort(error);
    rejectTimeout(error);
   }, this.idleTimeoutMs);
  };
  progress(0);
  const work = Promise.resolve().then(() => operation(progress, signal));
  try {
   return await Promise.race([work, timeout]);
  } finally {
   clearTimeout(timer);
   this.transfers.delete(id);
   if (signal.aborted && temporaryPath) {
    const removeLateFile = () => unlink(temporaryPath).catch(() => {});
    void work.then(removeLateFile, removeLateFile);
   }
  }
 }
 describe(m){if(!m)return m;return {...m,transfer:this.transfers.get(m.media_id||m.id)??null};}
 activity(){return [...this.transfers.entries()].filter(([,v])=>Date.now()-v.updated_at<120000).map(([id,v])=>({id,name:this.store.get(id)?.name,...v}));}
 async lock(id,fn){while(this.locks.has(id))await this.locks.get(id).catch(()=>{});const p=fn();this.locks.set(id,p);try{return await p;}finally{if(this.locks.get(id)===p)this.locks.delete(id);}}
 async checkpointIfNeeded() {
  const state = this.store.syncState();
  if (this.store.settings().autoMetadata && state.revision > state.backed_up_revision) {
   await this.backupIndex();
  }
 }
 async tick() {
  if (this.running) return;
  this.running = true;
  try {
   await mkdir(this.dir, {recursive:true, mode:0o700});
   const attempted = [];
   for (let index = 0; index < this.batchSize; index++) {
    const settings = this.store.settings();
    if (!settings.enabled) break;
    const kinds = ["photos","videos","audio","documents","other"].filter(kind => settings[kind]);
    const [media] = this.store.queue(Date.now(), kinds, 1, settings, attempted);
    if (!media) break;
    attempted.push(media.id);
    try {
     await this.lock(media.id, () => this.process(media.id));
    } catch (error) {
     const latest = this.store.get(media.id);
     const delay = Math.min(3600000, 15000 * 2 ** Math.min(latest.attempts, 8));
     this.store.patch(media.id, {
      status:'failed', attempts:latest.attempts + 1, retry_at:Date.now() + delay,
      error:String(error.message).slice(0,180),
     });
    }
   }
   if (!this.backgroundCheckpoints) await this.checkpointIfNeeded();
   await this.cleanup();
  } finally {
   this.running = false;
  }
 }
 async process(id){let m=this.store.get(id),cfg=this.store.settings();if(!cfg.enabled||!cfg[m.kind])return;
  if(!await exists(m.path)){
   if (m.path) {
    this.store.patch(id, {path:null});
    m = this.store.get(id);
   }
   if(m.telegram_id){await this.retrieve(m);m=this.store.get(id);}
   else {if(!cfg.autoDownload)return;if(!m.raw)throw Error('Original media is unavailable; no backup exists');if(m.size>this.maxBytes)throw Error('Attachment exceeds configured Telegram upload limit');const target=join(this.dir,id),part=target+'.'+randomUUID()+'.part';this.store.patch(id,{status:'downloading'});try{await this.transfer(id,'downloading',m.size,(progress,signal)=>this.download(m,part,this.maxBytes,progress,signal),part);const s=await stat(part);if(!s.size||s.size>this.maxBytes||(m.size>0&&s.size!==m.size))throw Error('Incomplete or oversized WhatsApp download');const hash=await hashFile(part);await rename(part,target);this.store.patch(id,{path:target,size:s.size,sha256:hash,downloaded_at:Date.now(),status:'downloaded'});}finally{await unlink(part).catch(()=>{});}m=this.store.get(id);}
  }
  cfg=this.store.settings();if(!cfg.enabled||!cfg.autoUpload||!cfg[m.kind])return;
  if(!m.telegram_id){this.store.patch(id,{status:'uploading'});const duplicate=this.store.byHash(m.sha256);if(duplicate&&duplicate.id!==id){this.store.patch(id,{telegram_id:duplicate.telegram_id,telegram_peer:duplicate.telegram_peer,uploaded_at:duplicate.uploaded_at,status:'uploaded'});this.store.event(id,'reused_existing_upload',m.size);}else{const remote=await this.transfer(id,'uploading',m.size,(progress,signal)=>this.telegram.upload(m.path,m,progress,signal));this.store.patch(id,{telegram_id:remote.id??remote,telegram_peer:remote.peer??null,uploaded_at:Date.now(),status:'uploaded'});}m=this.store.get(id);}
  this.store.patch(id,{status:'verifying'});const verify=join(this.dir,id+'.'+randomUUID()+'.verify');try{await this.transfer(id,'verifying',m.size,(progress,signal)=>this.telegram.download(m.telegram_id,verify,m.telegram_peer,progress,signal),verify);if(await hashFile(verify)!==m.sha256)throw Error('Telegram verification failed; local copy retained');this.store.patch(id,{status:'verified',verified_at:Date.now(),manifest_at:null,error:null,raw:null,attempts:0,retry_at:0});this.transfers.delete(id);}finally{await unlink(verify).catch(()=>{});}
 }
 async retrieve(m){if(!m.telegram_id||!m.sha256)throw Error('No usable Telegram backup');const target=join(this.dir,m.id),part=target+'.'+randomUUID()+'.restore';await mkdir(this.dir,{recursive:true,mode:0o700});try{await this.transfer(m.id,'downloading',m.size,(progress,signal)=>this.telegram.download(m.telegram_id,part,m.telegram_peer,progress,signal),part);if(await hashFile(part)!==m.sha256)throw Error('Telegram copy differs from the archived file');await rename(part,target);this.store.patch(m.id,{path:target,downloaded_at:Date.now(),status:'verified',verified_at:Date.now(),error:null});this.store.event(m.id,'retrieved_from_telegram',m.size);return target;}finally{await unlink(part).catch(()=>{});}}
 async open(id){return this.lock(id,async()=>{const m=this.store.get(id);if(!m)throw Error('Attachment not found');if(await exists(m.path)&&await hashFile(m.path)===m.sha256)return m.path;if(!this.store.settings().cloudOpen)throw Error('Cloud retrieval is turned off in Settings');return this.retrieve(m);});}
 async backupIndex() {
  if (this.store.syncState().recovery_status === 'error') {
   throw Error('Resolve the recovery error before uploading a new index');
  }
  if (this.manifestLock) return this.manifestLock;
  this.manifestLock = (async () => {
   const snapshot = this.store.snapshot();
   if (!snapshot.media.length && !snapshot.messages.length) return;
   snapshot.telegramAccountId = this.telegram.accountId ?? null;
   const encoded = encodeSnapshot(snapshot, {mode:this.indexMode, key:this.indexKey});
   const messageId = await this.telegram.backupIndex(encoded);
   this.store.batch(() => {
    const mark = this.store.db.prepare(
     "UPDATE media SET manifest_at=? WHERE id=? AND status='verified' AND telegram_id=? AND sha256=?"
    );
    for (const media of snapshot.media) {
     if (media.status === 'verified') mark.run(snapshot.createdAt, media.id, media.telegram_id, media.sha256);
    }
    this.store.db.prepare(
     'UPDATE sync_state SET backed_up_revision=?,last_backup_at=?,backup_message_id=?,error=NULL WHERE id=1'
    ).run(snapshot.revision, snapshot.createdAt, messageId ?? null);
   });
  })();
  try {
   await this.manifestLock;
  } catch (error) {
   this.store.db.prepare('UPDATE sync_state SET error=? WHERE id=1').run(String(error.message).slice(0,250));
   throw error;
  } finally {
   this.manifestLock = null;
  }
 }
 async deleteLocal(id){return this.lock(id,async()=>{let m=this.store.get(id);if(!m||m.status!=='verified'||!m.telegram_id)throw Error('A verified Telegram backup is required before local deletion');if(!m.manifest_at){if(!this.store.settings().autoMetadata)throw Error('Back up the recovery index before deleting local files');await this.backupIndex();m=this.store.get(id);if(!m.manifest_at)throw Error("This file is waiting for the next recovery index. Try again after it completes.");}if(await exists(m.path)){if(await hashFile(m.path)!==m.sha256)throw Error('Local file changed; it was not deleted');await unlink(m.path);}this.store.patch(id,{path:null});});}
 async cleanup(now=Date.now()){const c=this.store.settings();if(!c.enabled||!c.autoCleanup)return;const cutoff=now-c.retentionDays*86400000;const rows=this.store.db.prepare("SELECT id FROM media WHERE status='verified' AND path IS NOT NULL AND manifest_at IS NOT NULL AND pinned=0 AND downloaded_at<=?").all(cutoff);for(const m of rows){if(!this.store.settings().enabled||!this.store.settings().autoCleanup)break;await this.deleteLocal(m.id);}}
}

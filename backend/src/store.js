import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
export const DEFAULTS = Object.freeze({enabled:true, autoDownload:true, autoUpload:true, autoCleanup:true, retentionDays:15, cloudOpen:true, photos:true, videos:true, audio:true, documents:true, other:true, autoMetadata:true});
const KINDS = ['photos','videos','audio','documents','other'];
export class Store {
  constructor(path) {
    mkdirSync(dirname(path), {recursive:true, mode:0o700});
    this.db = new DatabaseSync(path); chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, backed_up_revision INTEGER NOT NULL DEFAULT -1, last_backup_at INTEGER, backup_message_id INTEGER, last_restore_at INTEGER, telegram_account_id TEXT, recovery_status TEXT NOT NULL DEFAULT 'not_checked', error TEXT);
      INSERT OR IGNORE INTO sync_state(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, timestamp INTEGER NOT NULL, media_id TEXT);
      CREATE INDEX IF NOT EXISTS chat_messages ON messages(chat_id,timestamp DESC,id);
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, raw TEXT, status TEXT NOT NULL DEFAULT 'queued', path TEXT, sha256 TEXT, telegram_id INTEGER, verified_at INTEGER, manifest_at INTEGER, downloaded_at INTEGER, pinned INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE INDEX IF NOT EXISTS archive_queue ON media(status,retry_at);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, media_id TEXT, type TEXT NOT NULL, timestamp INTEGER NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, detail TEXT);`);
    const columns = new Set(this.db.prepare('PRAGMA table_info(media)').all().map(c=>c.name));
    for (const [key,type] of Object.entries({created_at:'INTEGER',uploaded_at:'INTEGER',telegram_peer:'TEXT'})) if(!columns.has(key))this.db.exec(`ALTER TABLE media ADD COLUMN ${key} ${type}`);
    if(!this.db.prepare('PRAGMA table_info(sync_state)').all().some(c=>c.name==='telegram_account_id'))this.db.exec('ALTER TABLE sync_state ADD COLUMN telegram_account_id TEXT');
    if(!this.db.prepare('PRAGMA table_info(sync_state)').all().some(c=>c.name==='backup_message_id'))this.db.exec('ALTER TABLE sync_state ADD COLUMN backup_message_id INTEGER');
    this.db.prepare("UPDATE media SET status='queued' WHERE status IN ('downloading','uploading','verifying')").run();
  }
  close(){this.db.close();}
  changed(){this.db.prepare('UPDATE sync_state SET revision=revision+1 WHERE id=1').run();}
  syncState(){return this.db.prepare('SELECT * FROM sync_state WHERE id=1').get();}
  bindTelegramAccount(id){const old=this.syncState().telegram_account_id;if(old&&old!==String(id))throw Error('This local archive belongs to another Telegram account; use its original account or a separate data folder');this.db.prepare('UPDATE sync_state SET telegram_account_id=? WHERE id=1').run(String(id));}
  recovery(status,error=null){this.db.prepare('UPDATE sync_state SET recovery_status=?,error=? WHERE id=1').run(status,error);}
  settings(){const r=this.db.prepare('SELECT value FROM settings WHERE id=1').get();return {...DEFAULTS,...(r?JSON.parse(r.value):{})};}
  updateSettings(input){
    const next=this.settings();
    for(const key of Object.keys(DEFAULTS)) if(key in input){
      if(key==='retentionDays'){if(!Number.isInteger(input[key])||input[key]<1||input[key]>365)throw Error('Retention must be 1–365 days');}
      else if(typeof input[key]!=='boolean')throw Error(`Invalid setting: ${key}`);
      next[key]=input[key];
    }
    this.db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(next));this.changed();return next;
  }
  chat(id,title,now=Date.now()){
    const old=this.db.prepare('SELECT * FROM chats WHERE id=?').get(id);
    if(old&&old.title===(title||id)&&old.updated>=now)return;
    this.db.prepare('INSERT INTO chats VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated=MAX(updated,excluded.updated)').run(id,title||id,now);this.changed();
  }
  message(m){
    const old=this.db.prepare('SELECT text FROM messages WHERE id=?').get(m.id);if(old?.text===(m.text||''))return;
    this.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text').run(m.id,m.chatId,m.sender||'',m.text||'',m.timestamp,m.mediaId||null);this.changed();
  }
  insertMedia(m){
    const old=this.get(m.id);
    if(old){if(old.status==='needs_source'&&m.raw)this.patch(m.id,{raw:m.raw,status:'queued',attempts:0,retry_at:0,error:null});return;}
    this.db.prepare('INSERT INTO media(id,chat_id,message_id,name,mime,kind,size,raw,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(m.id,m.chatId,m.messageId,m.name,m.mime,m.kind,m.size||0,m.raw||null,m.createdAt??Date.now());
    this.event(m.id,'discovered',m.size||0);this.changed();
  }
  event(id,type,bytes=0,detail=null,at=Date.now()){
    if(this.restoring)return;
    this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run(randomUUID(),id,type,at,bytes,detail);this.changed();
  }
  get(id){return this.db.prepare('SELECT * FROM media WHERE id=?').get(id);}
  byHash(hash){return this.db.prepare("SELECT * FROM media WHERE sha256=? AND status='verified' AND telegram_id IS NOT NULL LIMIT 1").get(hash);}
  patch(id,fields){
    const allowed=new Set(['status','path','size','sha256','telegram_id','telegram_peer','uploaded_at','created_at','verified_at','manifest_at','downloaded_at','pinned','attempts','retry_at','error','raw']);
    const entries=Object.entries(fields);if(!entries.length||entries.some(([k])=>!allowed.has(k)))throw Error('Invalid archive update');const old=this.get(id);if(!old)throw Error('Unknown attachment');
    this.db.prepare(`UPDATE media SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`).run(...entries.map(([,v])=>v),id);
    // Manifest bookkeeping and raw transport data are not cloud-visible state changes.
    if(entries.some(([k,v])=>!['manifest_at','raw'].includes(k)&&old[k]!==v))this.changed();
    if(fields.status&&fields.status!==old.status)this.event(id,fields.status,fields.size??old.size,fields.error??null);
    if('path' in fields&&fields.path===null&&old.path)this.event(id,'local_removed',old.size);
    if('pinned' in fields&&old.pinned!==fields.pinned)this.event(id,fields.pinned?'pinned':'unpinned');
  }
  queue(now=Date.now(),kinds=KINDS){if(!kinds.length)return [];return this.db.prepare(`SELECT * FROM media WHERE status IN ('queued','failed','downloaded','uploaded') AND retry_at<=? AND attempts<20 AND kind IN (${kinds.map(()=>'?').join(',')}) ORDER BY rowid LIMIT 100`).all(now,...kinds);}
  listMedia(cursor=0,limit=100,query=''){return this.db.prepare('SELECT rowid AS cursor,id,chat_id,message_id,name,mime,kind,size,status,sha256,telegram_id,telegram_peer,created_at,uploaded_at,verified_at,downloaded_at,pinned,attempts,error FROM media WHERE rowid>? AND name LIKE ? ORDER BY rowid LIMIT ?').all(cursor,`%${query}%`,limit);}
  chats(){return this.db.prepare('SELECT c.*, (SELECT text FROM messages WHERE chat_id=c.id ORDER BY timestamp DESC LIMIT 1) AS preview,(SELECT COUNT(*) FROM media WHERE chat_id=c.id) AS files FROM chats c ORDER BY updated DESC LIMIT 500').all();}
  messages(chat,before=Number.MAX_SAFE_INTEGER,beforeId=''){return this.db.prepare('SELECT m.*,a.name,a.mime,a.kind,a.size,a.status,a.sha256,a.verified_at,a.created_at,a.uploaded_at,a.telegram_id,a.telegram_peer FROM messages m LEFT JOIN media a ON a.id=m.media_id WHERE m.chat_id=? AND (m.timestamp<? OR (m.timestamp=? AND m.id<?)) ORDER BY m.timestamp DESC,m.id DESC LIMIT 100').all(chat,before,before,beforeId);}
  history(before=Number.MAX_SAFE_INTEGER,limit=100,beforeId=''){return this.db.prepare('SELECT e.*,m.name,m.chat_id FROM events e LEFT JOIN media m ON m.id=e.media_id WHERE (timestamp<? OR (timestamp=? AND e.id<?)) ORDER BY timestamp DESC,e.id DESC LIMIT ?').all(before,before,beforeId,limit);}
  stats(){
    const rows=this.db.prepare('SELECT kind,status,COUNT(*) AS files,COALESCE(SUM(size),0) AS bytes FROM media GROUP BY kind,status').all();
    const summary={total:0,verified:0,uploaded:0,pending:0,failed:0,needs_source:0,total_bytes:0,uploaded_bytes:0,verified_bytes:0,local_bytes:0,cloud_only:0,by_type:{},last_uploaded_at:null,last_verified_at:null};
    for(const r of rows){summary.total+=r.files;summary.total_bytes+=r.bytes;const kind=summary.by_type[r.kind]??={total:0,verified:0,bytes:0,verified_bytes:0};kind.total+=r.files;kind.bytes+=r.bytes;
      if(r.status==='verified'){summary.verified+=r.files;summary.verified_bytes+=r.bytes;kind.verified+=r.files;kind.verified_bytes+=r.bytes;}
      else if(r.status==='failed')summary.failed+=r.files;else if(r.status==='needs_source')summary.needs_source+=r.files;else summary.pending+=r.files;
    }
    const uploaded=this.db.prepare('SELECT COUNT(*) files,COALESCE(SUM(size),0) bytes,MAX(uploaded_at) last_upload,MAX(verified_at) last_verify FROM media WHERE telegram_id IS NOT NULL').get();summary.uploaded=uploaded.files;summary.uploaded_bytes=uploaded.bytes;summary.last_uploaded_at=uploaded.last_upload;summary.last_verified_at=uploaded.last_verify;
    const local=this.db.prepare("SELECT COALESCE(SUM(CASE WHEN path IS NOT NULL THEN size ELSE 0 END),0) bytes,SUM(CASE WHEN status='verified' AND path IS NULL THEN 1 ELSE 0 END) cloud FROM media").get();summary.local_bytes=local.bytes;summary.cloud_only=local.cloud||0;
    summary.unique_verified_files=this.db.prepare("SELECT COUNT(DISTINCT sha256) n FROM media WHERE status='verified'").get().n;return summary;
  }
  snapshot(){return {marker:'WHATSGRAMY_MANIFEST_V2',version:2,createdAt:Date.now(),revision:this.syncState().revision,settings:this.settings(),summary:this.stats(),chats:this.db.prepare('SELECT * FROM chats').all(),messages:this.db.prepare('SELECT * FROM messages').all(),events:this.db.prepare('SELECT * FROM events ORDER BY timestamp,id').all(),media:this.db.prepare('SELECT id,chat_id,message_id,name,mime,kind,size,status,sha256,telegram_id,telegram_peer,created_at,uploaded_at,verified_at,downloaded_at,pinned,attempts,error FROM media').all()};}
  restore(snapshot,{restoreSettings=this.stats().total===0}={}){
    validateSnapshot(snapshot);this.restoring=true;this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const c of snapshot.chats)this.chat(c.id,c.title,c.updated);
      for(const m of snapshot.messages)this.message({id:m.id,chatId:m.chat_id,sender:m.sender,text:m.text,timestamp:m.timestamp,mediaId:m.media_id});
      for(const m of snapshot.media){
        const old=this.get(m.id);if(old?.status==='verified')continue;
        this.insertMedia({id:m.id,chatId:m.chat_id,messageId:m.message_id,name:m.name,mime:m.mime,kind:m.kind,size:m.size,createdAt:m.created_at??null});
        const verified=(m.status===undefined||m.status==='verified')&&!!m.telegram_id&&!!m.sha256&&!!m.verified_at;
        this.patch(m.id,{status:verified?'verified':m.telegram_id&&m.sha256?'uploaded':'needs_source',sha256:m.sha256??null,telegram_id:m.telegram_id??null,telegram_peer:m.telegram_peer??snapshot.destination??null,created_at:m.created_at??null,uploaded_at:m.uploaded_at??null,verified_at:verified?m.verified_at:null,manifest_at:verified?snapshot.createdAt:null,pinned:m.pinned?1:0,error:verified?null:'Original local file is absent; reconnect WhatsApp if it is still available',attempts:0,retry_at:0});
      }
      for(const e of snapshot.events??[])this.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?)').run(e.id,e.media_id??null,e.type,e.timestamp,e.bytes??0,e.detail??null);
      // Restore user preferences only during automatic recovery into an empty archive.
      if(restoreSettings&&snapshot.settings)this.updateSettings(snapshot.settings);
      this.db.prepare("UPDATE sync_state SET last_restore_at=?,recovery_status='restored',error=NULL WHERE id=1").run(Date.now());this.changed();this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.restoring=false;}
  }
}
export function validateSnapshot(s){
 if(!s||![1,2].includes(s.version)||!Number.isSafeInteger(s.createdAt)||s.createdAt<0||!Array.isArray(s.media)||!Array.isArray(s.chats)||!Array.isArray(s.messages))throw Error('Unsupported or incomplete recovery index');
 if(s.version===2&&s.marker!=='WHATSGRAMY_MANIFEST_V2')throw Error('Invalid recovery marker');
 const str=(v,n=1000000)=>typeof v==='string'&&v.length<=n;
 for(const m of s.media){if(!str(m.id,64)||!/^[a-f0-9]{64}$/.test(m.id)||!str(m.chat_id,200)||!str(m.message_id,200)||!str(m.name,1024)||!str(m.mime,200)||!KINDS.includes(m.kind)||!Number.isSafeInteger(m.size)||m.size<0||(m.telegram_id!=null&&(!Number.isSafeInteger(m.telegram_id)||m.telegram_id<=0))||(m.sha256!=null&&!/^[a-f0-9]{64}$/.test(m.sha256)))throw Error('Invalid attachment in recovery index');}
 for(const c of s.chats)if(!str(c.id,200)||!str(c.title,10000)||!Number.isSafeInteger(c.updated))throw Error('Invalid chat metadata');
 for(const m of s.messages)if(!str(m.id,200)||!str(m.chat_id,200)||!str(m.sender,10000)||!str(m.text)||!Number.isSafeInteger(m.timestamp))throw Error('Invalid message metadata');
 for(const e of s.events??[])if(!str(e.id,200)||!str(e.type,100)||!Number.isSafeInteger(e.timestamp)||!Number.isSafeInteger(e.bytes??0))throw Error('Invalid upload history');
 return s;
}

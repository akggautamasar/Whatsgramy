import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export const DEFAULTS = Object.freeze({enabled:true, autoDownload:true, autoUpload:true, autoCleanup:true, retentionDays:15, cloudOpen:true, photos:true, videos:true, audio:true, documents:true, other:true});
export class Store {
  constructor(path) {
    mkdirSync(dirname(path), {recursive:true, mode:0o700});
    this.db = new DatabaseSync(path); chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, timestamp INTEGER NOT NULL, media_id TEXT);
      CREATE INDEX IF NOT EXISTS chat_messages ON messages(chat_id,timestamp DESC,id);
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, raw TEXT, status TEXT NOT NULL DEFAULT 'queued', path TEXT, sha256 TEXT, telegram_id INTEGER, verified_at INTEGER, manifest_at INTEGER, downloaded_at INTEGER, pinned INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE INDEX IF NOT EXISTS archive_queue ON media(status,retry_at);`);
    this.db.prepare("UPDATE media SET status='queued' WHERE status IN ('downloading','uploading','verifying')").run();
  }
  close(){this.db.close();}
  settings(){const r=this.db.prepare('SELECT value FROM settings WHERE id=1').get(); return {...DEFAULTS,...(r?JSON.parse(r.value):{})};}
  updateSettings(input){
    const next=this.settings();
    for(const key of Object.keys(DEFAULTS)) if(key in input) {
      if(key==='retentionDays'){if(!Number.isInteger(input[key])||input[key]<1||input[key]>365)throw Error('Retention must be 1–365 days');}
      else if(typeof input[key]!=='boolean')throw Error(`Invalid setting: ${key}`);
      next[key]=input[key];
    }
    this.db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(next)); return next;
  }
  chat(id,title,now=Date.now()){this.db.prepare('INSERT INTO chats VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated=MAX(updated,excluded.updated)').run(id,title||id,now);}
  message(m){this.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text').run(m.id,m.chatId,m.sender||'',m.text||'',m.timestamp,m.mediaId||null);}
  insertMedia(m){this.db.prepare('INSERT OR IGNORE INTO media(id,chat_id,message_id,name,mime,kind,size,raw) VALUES(?,?,?,?,?,?,?,?)').run(m.id,m.chatId,m.messageId,m.name,m.mime,m.kind,m.size||0,m.raw||null);}
  get(id){return this.db.prepare('SELECT * FROM media WHERE id=?').get(id);}
  patch(id,fields){const allowed=new Set(['status','path','size','sha256','telegram_id','verified_at','manifest_at','downloaded_at','pinned','attempts','retry_at','error','raw']); const entries=Object.entries(fields); if(!entries.length||entries.some(([k])=>!allowed.has(k)))throw Error('Invalid archive update'); this.db.prepare(`UPDATE media SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`).run(...entries.map(([,v])=>v),id);}
  queue(now=Date.now(),kinds=["photos","videos","audio","documents","other"]){if(!kinds.length)return [];return this.db.prepare(`SELECT * FROM media WHERE status IN ('queued','failed','downloaded','uploaded') AND retry_at<=? AND attempts<20 AND kind IN (${kinds.map(()=>"?").join(",")}) ORDER BY rowid LIMIT 100`).all(now,...kinds);}
  listMedia(cursor=0,limit=100,query=''){return this.db.prepare('SELECT rowid AS cursor,id,chat_id,message_id,name,mime,kind,size,status,sha256,verified_at,downloaded_at,pinned,error FROM media WHERE rowid>? AND name LIKE ? ORDER BY rowid LIMIT ?').all(cursor,`%${query}%`,limit);}
  chats(){return this.db.prepare('SELECT c.*, (SELECT text FROM messages WHERE chat_id=c.id ORDER BY timestamp DESC LIMIT 1) AS preview,(SELECT COUNT(*) FROM media WHERE chat_id=c.id) AS files FROM chats c ORDER BY updated DESC LIMIT 500').all();}
  messages(chat,before=Number.MAX_SAFE_INTEGER){return this.db.prepare('SELECT m.*,a.name,a.mime,a.kind,a.size,a.status,a.sha256,a.verified_at FROM messages m LEFT JOIN media a ON a.id=m.media_id WHERE m.chat_id=? AND m.timestamp<? ORDER BY m.timestamp DESC,m.id DESC LIMIT 100').all(chat,before);}
  stats(){return this.db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,SUM(CASE WHEN path IS NOT NULL THEN size ELSE 0 END) local_bytes FROM media").get();}
  snapshot(){return {version:1,createdAt:Date.now(),settings:this.settings(),chats:this.db.prepare('SELECT * FROM chats').all(),messages:this.db.prepare('SELECT * FROM messages').all(),media:this.db.prepare("SELECT id,chat_id,message_id,name,mime,kind,size,sha256,telegram_id,verified_at,pinned FROM media WHERE status='verified'").all()};}
  restore(snapshot){if(snapshot.version!==1||!Array.isArray(snapshot.media))throw Error('Unsupported index');this.db.exec('BEGIN IMMEDIATE');try{for(const c of snapshot.chats)this.chat(c.id,c.title,c.updated);for(const m of snapshot.messages)this.message({id:m.id,chatId:m.chat_id,sender:m.sender,text:m.text,timestamp:m.timestamp,mediaId:m.media_id});for(const m of snapshot.media){this.insertMedia({id:m.id,chatId:m.chat_id,messageId:m.message_id,name:m.name,mime:m.mime,kind:m.kind,size:m.size});this.patch(m.id,{status:'verified',sha256:m.sha256,telegram_id:m.telegram_id,verified_at:m.verified_at,manifest_at:snapshot.createdAt,pinned:m.pinned});}this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
}

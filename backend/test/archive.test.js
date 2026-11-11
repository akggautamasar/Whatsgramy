import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,copyFile,rm,stat,unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';import { join } from 'node:path';import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';import { Archive,hashFile,seal,unseal } from '../src/archive.js';import { createApp } from '../src/http.js';import { classify, WhatsAppConnection } from '../src/whatsapp.js';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'whatsgramy-'));const store=new Store(join(dir,'index.db'));const bytes=Buffer.from('PDF/photo/video attachment sample'),remote=join(dir,'telegram.bin');let corrupt=false;let uploads=0;let snapshots=[];const tg={authorized:true,upload:async p=>{uploads++;await copyFile(p,remote);return 42;},download:async(id,p)=>{assert.equal(id,42);if(corrupt)await writeFile(p,'wrong bytes');else await copyFile(remote,p);},backupIndex:async b=>{snapshots.push(b);}};const key=randomBytes(32);const archive=new Archive({store,telegram:tg,download:async(m,p)=>writeFile(p,bytes),dir:join(dir,'media'),indexKey:key});const id='a'.repeat(64);store.chat('chat','Office');store.message({id,chatId:'chat',timestamp:1,mediaId:id,text:'Order'});store.insertMedia({id,chatId:'chat',messageId:'wa-123',name:'Order.pdf',kind:'documents',mime:'application/pdf',size:bytes.length,raw:'{}'});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return {archive,store,id,bytes,key,dir,tg,setCorrupt:v=>corrupt=v,getUploads:()=>uploads,snapshots};}
test('archive → verified index → manual deletion → Telegram fallback restores identical bytes',async t=>{const f=await fixture(t);await f.archive.tick();let m=f.store.get(f.id);assert.equal(m.status,'verified');assert.ok(m.manifest_at);assert.equal(f.getUploads(),1);assert.equal(unseal(f.snapshots[0],f.key).media[0].telegram_id,42);await f.archive.deleteLocal(f.id);assert.equal(f.store.get(f.id).path,null);const path=await f.archive.open(f.id);assert.deepEqual(await readFile(path),f.bytes);assert.ok(f.store.get(f.id).downloaded_at);});
test('failed remote verification never permits deletion',async t=>{const f=await fixture(t);f.setCorrupt(true);await f.archive.tick();const m=f.store.get(f.id);assert.equal(m.status,'failed');assert.ok(await stat(m.path));await assert.rejects(f.archive.deleteLocal(f.id),/verified/);});
test('15-day cleanup preserves pinned and unverified files; retrying uploaded verification does not reupload',async t=>{const f=await fixture(t);f.setCorrupt(true);await f.archive.tick();f.setCorrupt(false);f.store.patch(f.id,{retry_at:0});await f.archive.tick();assert.equal(f.getUploads(),1);const old=Date.now()-16*86400000;f.store.patch(f.id,{downloaded_at:old,pinned:1});await f.archive.cleanup();assert.ok(f.store.get(f.id).path);f.store.patch(f.id,{pinned:0});await f.archive.cleanup();assert.equal(f.store.get(f.id).path,null);});
test('disabled master and category block new transfers; cloud retrieval switch blocks missing local files',async t=>{const f=await fixture(t);f.store.updateSettings({enabled:false});await f.archive.tick();assert.equal(f.getUploads(),0);f.store.updateSettings({enabled:true,documents:false});await f.archive.tick();assert.equal(f.getUploads(),0);f.store.updateSettings({documents:true});await f.archive.tick();await f.archive.deleteLocal(f.id);f.store.updateSettings({cloudOpen:false});await assert.rejects(f.archive.open(f.id),/turned off/);});
test('index restore retains Telegram mappings after database loss',async t=>{const f=await fixture(t);await f.archive.tick();const second=new Store(join(f.dir,'restored.db'));try{second.restore(unseal(f.snapshots[0],f.key));assert.equal(second.get(f.id).telegram_id,42);assert.equal(second.get(f.id).path,null);}finally{second.close();}});
test('authenticated API rejects unauthenticated access and validates settings and IDs',async t=>{const f=await fixture(t),app=createApp({store:f.store,archive:f.archive,wa:{connection:'open'},tg:f.tg,token:'secret'});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());const url=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(url+'/api/status')).status,401);const headers={Authorization:'Bearer secret','Content-Type':'application/json'};assert.equal((await fetch(url+'/api/status',{headers})).status,200);assert.equal((await fetch(url+'/api/settings',{method:'PUT',headers,body:JSON.stringify({retentionDays:0})})).status,400);assert.equal((await fetch(url+'/api/media/not-an-id/file',{headers})).status,400);});
test('view-once and disappearing-message wrappers are excluded',()=>{assert.equal(classify({viewOnceMessage:{message:{imageMessage:{}}}}),null);assert.equal(classify({ephemeralMessage:{message:{videoMessage:{}}}}),null);assert.equal(classify({documentMessage:{fileName:'x.pdf',mimetype:'application/pdf'}}).kind,'documents');});
test('encrypted index rejects tampering and wrong recovery key',()=>{const k=randomBytes(32),b=seal({version:1},k);b[b.length-1]^=1;assert.throws(()=>unseal(b,k));assert.throws(()=>unseal(seal({},k),randomBytes(32)));});
test('disabled media types cannot block eligible attachments behind a large backlog',async t=>{const f=await fixture(t);f.store.updateSettings({photos:false});for(let i=0;i<150;i++)f.store.insertMedia({id:'p'+i,chatId:'chat',messageId:'p'+i,name:'p.jpg',mime:'image/jpeg',kind:'photos',size:1,raw:'{}'});f.store.db.prepare('UPDATE media SET rowid=1000 WHERE id=?').run(f.id);const queue=f.store.queue(Date.now(),['documents']);assert.deepEqual(queue.map(m=>m.id),[f.id]);});
test('login-only recovery discovers Saved Messages metadata and falls back past a corrupt checkpoint',async t=>{
 const f=await fixture(t);f.archive.indexMode='telegram';f.tg.accountId='123';await f.archive.tick();f.store.updateSettings({retentionDays:30});await f.archive.tick();
 const {recoverArchive,decodeSnapshot}=await import('../src/metadata.js');const latest=f.snapshots.at(-1);const snap=decodeSnapshot(latest);
 assert.equal(snap.summary.verified,1);assert.equal(snap.media[0].name,'Order.pdf');assert.ok(snap.media[0].uploaded_at);assert.ok(snap.events.some(e=>e.type==='uploaded'));assert.equal(snap.settings.retentionDays,30);
 assert.equal('path' in snap.media[0],false);assert.equal('raw' in snap.media[0],false);
 const restored=new Store(join(f.dir,'auto-restored.db'));try{
  const source={accountId:'123',async *readManifests(){yield {download:async()=>Buffer.from('broken')};yield {download:async()=>latest};}};
  const result=await recoverArchive(restored,source);assert.equal(result.status,'restored');assert.equal(restored.stats().verified,1);assert.equal(restored.settings().retentionDays,30);assert.equal(restored.get(f.id).telegram_id,42);assert.equal(restored.get(f.id).path,null);
  assert.equal(restored.history().filter(e=>e.type==='uploaded').length,f.store.history().filter(e=>e.type==='uploaded').length);
  source.readManifests=()=>{throw Error('An existing local archive must not be overwritten');};assert.equal((await recoverArchive(restored,source)).status,'existing');
 }finally{restored.close();}
});
test('pending records recover as needs-source and a matching WhatsApp message revives them',async t=>{
 const f=await fixture(t);const {encodeSnapshot,decodeSnapshot}=await import('../src/metadata.js');const snapshot=decodeSnapshot(encodeSnapshot(f.store.snapshot()));
 const recovered=new Store(join(f.dir,'pending-restore.db'));try{recovered.restore(snapshot);assert.equal(recovered.get(f.id).status,'needs_source');assert.equal(recovered.stats().uploaded,0);assert.equal(recovered.queue().length,0);
  recovered.insertMedia({id:f.id,chatId:'chat',messageId:'wa-123',name:'Order.pdf',mime:'application/pdf',kind:'documents',size:f.bytes.length,raw:'new-message'});assert.equal(recovered.get(f.id).status,'queued');assert.equal(recovered.get(f.id).raw,'new-message');
 }finally{recovered.close();}
});
test('wrong-account and unreadable recovery indexes are rejected without changing records',async t=>{
 const f=await fixture(t);const {encodeSnapshot,recoverArchive}=await import('../src/metadata.js');const bytes=encodeSnapshot({...f.store.snapshot(),telegramAccountId:'other'});const empty=new Store(join(f.dir,'wrong-account.db'));
 try{await assert.rejects(recoverArchive(empty,{accountId:'mine',async *readManifests(){yield {download:async()=>bytes};}}),/different Telegram account/);assert.equal(empty.stats().total,0);assert.equal(empty.syncState().recovery_status,'error');}finally{empty.close();}
});
test('same content in two messages reuses the existing Telegram upload and keeps both chat mappings',async t=>{
 const f=await fixture(t);await f.archive.tick();const second='b'.repeat(64);f.store.insertMedia({id:second,chatId:'chat',messageId:'wa-456',name:'Forwarded.pdf',mime:'application/pdf',kind:'documents',size:f.bytes.length,raw:'{}'});await f.archive.tick();assert.equal(f.getUploads(),1);assert.equal(f.store.stats().verified,2);assert.equal(f.store.stats().unique_verified_files,1);assert.equal(f.store.get(second).telegram_id,42);
});
test('metadata switch pauses automatic checkpoints and uncheckpointed files cannot be cleaned up',async t=>{
 const f=await fixture(t);f.store.updateSettings({autoMetadata:false});await f.archive.tick();assert.equal(f.snapshots.length,0);await assert.rejects(f.archive.deleteLocal(f.id),/recovery index/);await f.archive.backupIndex();assert.equal(f.snapshots.length,1);await f.archive.deleteLocal(f.id);assert.equal(f.store.get(f.id).path,null);
});
test('switching Telegram accounts cannot reuse another local archive',async t=>{const f=await fixture(t);f.store.bindTelegramAccount('original');const {recoverArchive}=await import('../src/metadata.js');await assert.rejects(recoverArchive(f.store,{accountId:'different'}),/another Telegram account/);assert.equal(f.store.get(f.id).status,'queued');assert.equal(f.store.syncState().recovery_status,'error');await assert.rejects(f.archive.backupIndex(),/recovery error/);});
test('serialized Telegram channel references survive a new default destination',async()=>{const {TelegramArchive}=await import('../src/telegram.js');const {Api}=await import('telegram');const bigInt=(await import('big-integer')).default;const adapter=new TelegramArchive({destination:'me'});adapter.authorized=true;adapter.client={};const peer=new Api.InputPeerChannel({channelId:bigInt('123456789'),accessHash:bigInt('987654321012345')});const recovered=await adapter.peer(adapter.describePeer(peer));assert.equal(recovered.channelId.toString(),'123456789');assert.equal(recovered.accessHash.toString(),'987654321012345');});
test('activity and message pagination do not skip records sharing a timestamp',async t=>{const f=await fixture(t);for(let i=0;i<250;i++){f.store.event(f.id,'batch',1,null,123456);f.store.message({id:'msg-'+i,chatId:'bulk',sender:'S',text:'M',timestamp:123456});}let before=Number.MAX_SAFE_INTEGER,id='',seen=new Set();while(true){const page=f.store.history(before,100,id);if(!page.length)break;for(const e of page)seen.add(e.id);before=page.at(-1).timestamp;id=page.at(-1).id;}assert.equal(seen.size,f.store.db.prepare('SELECT COUNT(*) n FROM events').get().n);before=Number.MAX_SAFE_INTEGER;id='';let count=0;while(true){const page=f.store.messages('bulk',before,id);if(!page.length)break;count+=page.length;before=page.at(-1).timestamp;id=page.at(-1).id;}assert.equal(count,250);});

test('a stalled attachment releases the queue and leaves its source available for retry', async t => {
 const f = await fixture(t);
 const next = 'c'.repeat(64);
 f.store.db.prepare('UPDATE messages SET timestamp=? WHERE id=?').run(Date.now()+1000,f.id);
 f.store.insertMedia({id:next,chatId:'chat',messageId:'next',name:'Next.pdf',kind:'documents',mime:'application/pdf',size:f.bytes.length,raw:'{}'});
 f.archive.idleTimeoutMs = 40;
 let aborted = false;
 f.archive.download = (media, path, maxBytes, progress, signal) => {
  if (media.id === next) return writeFile(path, f.bytes);
  return new Promise((_, reject) => signal.addEventListener('abort', () => {
   aborted = true;
   reject(signal.reason);
  }, {once:true}));
 };
 await f.archive.tick();
 assert.equal(aborted, true, JSON.stringify(f.store.get(f.id)));
 assert.match(f.store.get(f.id).error, /stalled/);
 assert.ok(f.store.get(f.id).retry_at > Date.now());
 assert.equal(f.store.get(f.id).raw, '{}');
 assert.equal(f.store.get(next).status, 'verified');
 assert.equal(f.archive.activity().length, 0);
});

test('history import yields to archive reads while indexing 5,673 attachments', async t => {
 const f = await fixture(t);
 const wa = new WhatsAppConnection({dir:f.dir,store:f.store});
 const count = 5673;
 const chats = Array.from({length:400}, (_,i) => ({id:`chat-${i}@g.us`,name:`Group ${i}`}));
 const messages = Array.from({length:count}, (_,i) => ({
  key:{id:`history-${i}`,remoteJid:chats[i%chats.length].id},
  messageTimestamp:1_750_000_000+i,
  message:{imageMessage:{mimetype:'image/jpeg',fileLength:128,caption:`Photo ${i}`}},
 }));
 const ingest = wa.ingestBatch(chats, messages, '12345@s.whatsapp.net');
 await new Promise(resolve => setImmediate(resolve));
 assert.ok(f.store.stats().total < count, 'history write must yield while work remains');
 assert.ok(f.store.chats().length > 0);
 await ingest;
 assert.equal(f.store.stats().total, count+1);
 assert.equal(f.store.chats().length, 401);
 assert.equal(f.store.history(Number.MAX_SAFE_INTEGER,60).length, 60);
 assert.equal(f.store.listMedia(0,30).length,30);
});

test('new attachments and staged uploads are selected without queueing disabled work', async t => {
 const f = await fixture(t);
 const newest = 'd'.repeat(64);
 const staged = 'e'.repeat(64);
 for (const [id, createdAt] of [[newest,20],[staged,10]]) {
  f.store.insertMedia({id,chatId:'chat',messageId:id,name:'File.pdf',kind:'documents',mime:'application/pdf',size:33,raw:'{}',createdAt});
 }
 f.store.patch(staged,{path:join(f.dir,'staged.pdf'),status:'downloaded'});
 assert.deepEqual(f.store.queue().map(item=>item.id), [staged,newest,f.id]);
 const captureOnly = f.store.updateSettings({autoUpload:false});
 assert.deepEqual(f.store.queue(Date.now(),['documents'],100,captureOnly).map(item=>item.id),[newest,f.id]);
 const uploadOnly = f.store.updateSettings({autoDownload:false,autoUpload:true});
 assert.deepEqual(f.store.queue(Date.now(),['documents'],100,uploadOnly).map(item=>item.id),[staged]);
});

test('a file verified during a checkpoint stays on disk until a later index includes it', async t => {
 const f = await fixture(t);
 f.archive.backgroundCheckpoints = true;
 let finish;
 f.tg.backupIndex = () => new Promise(resolve => { finish = resolve; });
 const checkpoint = f.archive.checkpointIfNeeded();
 await f.archive.tick();
 assert.equal(f.store.get(f.id).status,'verified');
 assert.equal(f.store.get(f.id).manifest_at,null);
 const remove = assert.rejects(f.archive.deleteLocal(f.id),/next recovery index/);
 await new Promise(resolve => setImmediate(resolve));
 finish(500);
 await checkpoint;
 await remove;
 assert.ok(await stat(f.store.get(f.id).path));
 f.tg.backupIndex = async () => 501;
 await f.archive.checkpointIfNeeded();
 await f.archive.deleteLocal(f.id);
 assert.equal(f.store.get(f.id).path,null);
});

test('first Telegram connection restores backups even after WhatsApp history arrives', async t => {
 const f = await fixture(t);
 f.archive.indexMode='telegram';
 f.tg.accountId='123';
 await f.archive.tick();
 const pending='f'.repeat(64);
 const media={id:pending,chatId:'chat',messageId:'pending',name:'Pending.pdf',mime:'application/pdf',kind:'documents',size:5,raw:'{}'};
 f.store.insertMedia(media);
 await f.archive.backupIndex();
 const target=new Store(join(f.dir,'preloaded.db'));
 try {
  target.insertMedia(media);
  const {recoverArchive}=await import('../src/metadata.js');
  const bytes=f.snapshots.at(-1);
  const source={accountId:'123',async *readManifests(){yield {download:async()=>bytes};}};
  assert.equal((await recoverArchive(target,source)).status,'restored');
  assert.equal(target.get(f.id).status,'verified');
  assert.equal(target.get(pending).status,'queued');
  assert.equal(target.get(pending).raw,'{}');
 } finally {
  target.close();
 }
});

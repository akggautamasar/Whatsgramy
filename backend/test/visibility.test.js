import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
test('file and chat responses distinguish real phone copies from verified Telegram backups without exposing paths',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wg-visible-'));const store=new Store(join(dir,'archive.sqlite'));
 try{const id='a'.repeat(64);const file=join(dir,'photo');await writeFile(file,'photo');store.chat('team','Project team');store.message({id:'m',chatId:'team',text:'Photo',timestamp:42,mediaId:id,fromMe:true});store.insertMedia({id,chatId:'team',messageId:'m',name:'photo.jpg',mime:'image/jpeg',kind:'photos',size:5});store.patch(id,{status:'downloaded',path:file});
  let item=store.listMedia()[0];assert.equal(item.device_local,true);assert.equal(item.telegram_saved,false);assert.equal(item.path,undefined);assert.equal(store.messages('team')[0].from_me,1);
  store.patch(id,{status:'uploaded',telegram_id:12});assert.equal(store.listMedia()[0].telegram_saved,false);
  store.patch(id,{status:'verified',verified_at:Date.now()});assert.equal(store.listMedia()[0].telegram_saved,true);assert.equal(store.chats()[0].saved_files,1);assert.equal(store.stats().local_files,1);
  await rm(file);item=store.listMedia()[0];assert.equal(item.device_local,false);assert.equal(item.telegram_saved,true);assert.equal(store.stats().local_files,0);assert.equal(store.messages('team')[0].device_local,false);
  const restored=new Store(join(dir,'restore.sqlite'));try{restored.restore(store.snapshot());assert.equal(restored.messages('team')[0].from_me,1);}finally{restored.close();}
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('live transfer progress includes file identity and phase without pretending an upload is verified',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wg-progress-'));const store=new Store(join(dir,'archive.sqlite'));
 try{const id='b'.repeat(64);store.insertMedia({id,chatId:'team',messageId:'m',name:'video.mp4',mime:'video/mp4',kind:'videos',size:100});const a=new Archive({store,dir,telegram:{},download:()=>{}});a.progress(id,'uploading',25,100);const item=a.describe(store.listMedia()[0]);assert.equal(item.transfer.percent,25);assert.equal(item.telegram_saved,false);assert.equal(a.activity()[0].name,'video.mp4');a.progress(id,'verifying',100,100);assert.equal(a.describe(store.listMedia()[0]).transfer.phase,'verifying');assert.equal(a.describe(store.listMedia()[0]).telegram_saved,false);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

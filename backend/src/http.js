import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { setImmediate as yieldToRequests } from 'node:timers/promises';
export function createApp({store,archive,wa,tg,token,login}){
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));app.get('/health',(_,res)=>res.json({ok:true}));
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');const actual=Buffer.from(req.get('authorization')||''),expected=Buffer.from(`Bearer ${token}`);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return res.status(401).json({error:'Unauthorized'});next();});
 app.get('/api/status',(_,res)=>res.json({whatsapp:{connection:wa.connection,qr:wa.qr},telegram:{connected:tg.authorized},folderOnly:!!archive.folderOnly,settings:store.settings(),stats:store.stats(),metadata:store.syncState(),transfers:archive.activity?.()??[]}));
 if(login){
 app.get('/api/telegram/login',(_,res)=>res.json(login.status()));
 app.post('/api/telegram/login',async(req,res)=>{await login.start(req.body);res.json(login.status());});
 app.post('/api/telegram/answer',(req,res)=>{login.answer(req.body.value);res.json(login.status());});
 }
 app.get('/api/settings',(_,res)=>res.json(store.settings()));app.put('/api/settings',(req,res)=>{try{res.json(store.updateSettings(req.body));}catch(e){res.status(400).json({error:e.message});}});
 app.post('/api/whatsapp/start',async(_,res)=>{await wa.start();res.json({ok:true});});
 app.post('/api/whatsapp/pair',async(req,res)=>res.json({code:await wa.pair(String(req.body.phone||''))}));
 app.get('/api/history',(req,res)=>res.json({items:store.history(Number(req.query.before)||Number.MAX_SAFE_INTEGER,Math.max(1,Math.min(200,Number(req.query.limit)||100)),String(req.query.beforeId||''))}));
 app.get('/api/chats',(_,res)=>res.json({items:store.chats()}));
 app.get('/api/messages',(req,res)=>res.json({items:store.messages(String(req.query.chat||''),Number(req.query.before)||Number.MAX_SAFE_INTEGER,String(req.query.beforeId||'')).map(m=>archive.describe?.(m)??m)}));
 app.get('/api/media',(req,res)=>{const cursor=Math.max(0,Number(req.query.cursor)||0),limit=Math.max(1,Math.min(200,Number(req.query.limit)||100));res.json({items:store.listMedia(cursor,limit,String(req.query.q||''),String(req.query.filter||'')).map(m=>archive.describe?.(m)??m)});});
 if (archive.folderOnly) {
  app.get('/api/backup/chats', (_, res) => {
   res.json({items:store.db.prepare(
    'SELECT id,title,EXISTS(SELECT 1 FROM selected_chats WHERE id=chats.id) AS backup_selected FROM chats ORDER BY title COLLATE NOCASE'
   ).all()});
  });
  app.put('/api/backup/chats', (req, res) => {
   const {changes} = req.body ?? {};
   if (!Array.isArray(changes) || changes.length > 500 ||
       changes.some(item => !item || typeof item.id !== 'string' || typeof item.selected !== 'boolean')) {
    throw Error('Invalid chat selection');
   }
   store.batch(() => {
    for (const item of changes) store.selectChat(item.id, item.selected);
   });
   res.json({ok:true});
  });
  app.get('/api/folder/candidates', async (_, res) => {
   const settings = store.settings();
   if (!settings.enabled || !settings.autoDownload || !settings.autoUpload) return res.json({items:[]});
   const rows = store.db.prepare(`
    SELECT id,size,kind,expected_sha,raw FROM media
    WHERE chat_id IN (SELECT id FROM selected_chats) AND status != 'verified'
      AND path IS NULL AND telegram_id IS NULL AND size BETWEEN 1 AND ?
   `).all(archive.maxBytes);
   const items = [];
   const update = store.db.prepare('UPDATE media SET expected_sha=? WHERE id=?');
   for (let offset = 0; offset < rows.length; offset += 80) {
    for (const row of rows.slice(offset, offset + 80)) {
     if (!settings[row.kind]) continue;
     const sha = row.expected_sha ?? wa.expectedHash(row.raw);
     if (!sha) continue;
     if (!row.expected_sha) update.run(sha,row.id);
     items.push({id:row.id,size:row.size,sha});
    }
    await yieldToRequests();
   }
   res.json({items});
  });
 }
 app.use('/api/media/:id',(req,res,next)=>{if(!/^[a-f0-9]{64}$/.test(req.params.id))return res.status(400).json({error:'Invalid attachment ID'});if(!store.get(req.params.id))return res.status(404).json({error:'Attachment not found'});next();});
 if (archive.folderOnly) {
  app.put('/api/media/:id/folder-source', async (req, res) => {
   const staged = await archive.stageFolderFile(req.params.id, req);
   if (!staged) req.resume();
   res.json({staged});
  });
 }
 app.get('/api/media/:id/file',async(req,res)=>{const m=store.get(req.params.id),path=await archive.open(m.id);res.type(m.mime);res.set('X-Content-Type-Options','nosniff');res.sendFile(path);});
 app.post('/api/media/:id/delete-local',async(req,res)=>{await archive.deleteLocal(req.params.id);res.json({ok:true});});
 app.post('/api/media/:id/pin',(req,res)=>{if(typeof req.body.pinned!=='boolean')return res.status(400).json({error:'Expected pinned boolean'});store.patch(req.params.id,{pinned:req.body.pinned?1:0});res.json({ok:true});});
 app.post('/api/media/:id/retry',(req,res)=>{const m=store.get(req.params.id);if(m.status!=='verified')store.patch(m.id,{attempts:0,retry_at:0,status:'queued',error:null});res.json({ok:true});});
 app.post('/api/index/backup',async(_,res)=>{await archive.backupIndex();res.json({ok:true});});
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(400).json({error:String(err.message||'Request failed').slice(0,180)});});
 return app;
}

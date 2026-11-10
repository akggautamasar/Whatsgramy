import express from 'express';
import { timingSafeEqual } from 'node:crypto';
export function createApp({store,archive,wa,tg,token}){
 const app=express();app.disable('x-powered-by');app.use(express.json({limit:'16kb'}));app.get('/health',(_,res)=>res.json({ok:true}));
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');const actual=Buffer.from(req.get('authorization')||''),expected=Buffer.from(`Bearer ${token}`);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return res.status(401).json({error:'Unauthorized'});next();});
 app.get('/api/status',(_,res)=>res.json({whatsapp:{connection:wa.connection,qr:wa.qr},telegram:{connected:tg.authorized},settings:store.settings(),stats:store.stats(),metadata:store.syncState()}));
 app.get('/api/settings',(_,res)=>res.json(store.settings()));app.put('/api/settings',(req,res)=>{try{res.json(store.updateSettings(req.body));}catch(e){res.status(400).json({error:e.message});}});
 app.post('/api/whatsapp/start',async(_,res)=>{await wa.start();res.json({ok:true});});
 app.post('/api/whatsapp/pair',async(req,res)=>res.json({code:await wa.pair(String(req.body.phone||''))}));
 app.get('/api/history',(req,res)=>res.json({items:store.history(Number(req.query.before)||Number.MAX_SAFE_INTEGER,Math.max(1,Math.min(200,Number(req.query.limit)||100)),String(req.query.beforeId||''))}));
 app.get('/api/chats',(_,res)=>res.json({items:store.chats()}));
 app.get('/api/messages',(req,res)=>res.json({items:store.messages(String(req.query.chat||''),Number(req.query.before)||Number.MAX_SAFE_INTEGER,String(req.query.beforeId||''))}));
 app.get('/api/media',(req,res)=>{const cursor=Math.max(0,Number(req.query.cursor)||0),limit=Math.max(1,Math.min(200,Number(req.query.limit)||100));res.json({items:store.listMedia(cursor,limit,String(req.query.q||''))});});
 app.use('/api/media/:id',(req,res,next)=>{if(!/^[a-f0-9]{64}$/.test(req.params.id))return res.status(400).json({error:'Invalid attachment ID'});if(!store.get(req.params.id))return res.status(404).json({error:'Attachment not found'});next();});
 app.get('/api/media/:id/file',async(req,res)=>{const m=store.get(req.params.id),path=await archive.open(m.id);res.type(m.mime);res.set('X-Content-Type-Options','nosniff');res.sendFile(path);});
 app.post('/api/media/:id/delete-local',async(req,res)=>{await archive.deleteLocal(req.params.id);res.json({ok:true});});
 app.post('/api/media/:id/pin',(req,res)=>{if(typeof req.body.pinned!=='boolean')return res.status(400).json({error:'Expected pinned boolean'});store.patch(req.params.id,{pinned:req.body.pinned?1:0});res.json({ok:true});});
 app.post('/api/media/:id/retry',(req,res)=>{const m=store.get(req.params.id);if(m.status!=='verified')store.patch(m.id,{attempts:0,retry_at:0,status:'queued',error:null});res.json({ok:true});});
 app.post('/api/index/backup',async(_,res)=>{await archive.backupIndex();res.json({ok:true});});
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);res.status(400).json({error:String(err.message||'Request failed').slice(0,180)});});
 return app;
}

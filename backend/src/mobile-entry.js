import { readFile,writeFile,mkdir,access } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from './store.js';
import { Archive } from './archive.js';
import { TelegramArchive } from './telegram.js';
import { WhatsAppConnection } from './whatsapp.js';
import { recoverArchive } from './metadata.js';
import { createApp } from './http.js';
import { MobileLogin } from './mobile-login.js';
process.umask(0o077);
const dir=process.argv[2];if(!dir)throw Error('Missing private engine directory');await mkdir(dir,{recursive:true});process.env.TMPDIR=join(dir,'tmp');await mkdir(process.env.TMPDIR,{recursive:true});
const privateConfig=JSON.parse(await readFile(join(dir,'engine.json'),'utf8'));
const credentials=JSON.parse(await readFile(join(dir,'telegram-api.json'),'utf8').catch(()=>'{}'));
const cfg={...credentials,dir,token:privateConfig.token,indexKey:Buffer.from(privateConfig.indexKey,'hex'),indexMode:'telegram',destination:'me'};
// Opening SQLite here makes missing runtime support a startup failure, visible to CI.
const probe=new DatabaseSync(':memory:');probe.exec('CREATE TABLE runtime_test(value TEXT)');probe.close();
const store=new Store(join(dir,'archive.sqlite')),tg=new TelegramArchive(cfg),wa=new WhatsAppConnection({dir,store});
const archive=new Archive({store,telegram:tg,download:(...args)=>wa.download(...args),dir:join(dir,'media'),indexKey:cfg.indexKey,indexMode:cfg.indexMode});
let recovered=false;
async function recover(){recovered=false;await recoverArchive(store,tg,cfg.indexKey);recovered=true;}

const login=new MobileLogin(tg,recover);
const app=createApp({store,archive,wa,tg,token:cfg.token,login});
app.listen(8787,'127.0.0.1',async()=>{await writeFile(join(dir,'ready.json'),JSON.stringify({node:process.version,sqlite:true,phoneOnly:true}));});
login.busy=!!cfg.apiId;login.state=cfg.apiId?'reconnecting':'idle';void (async()=>{try{await tg.connect().catch(()=>{});if(tg.authorized)await recover().catch(()=>{});}finally{login.busy=false;login.state=tg.authorized?'connected':'idle';}})();
if(store.settings().enabled&&await access(join(dir,'whatsapp-session/creds.json')).then(()=>true,()=>false))await wa.start().catch(()=>{});
setInterval(()=>{if(recovered)archive.tick().catch(()=>{});},5000);

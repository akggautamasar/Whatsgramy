import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export class MobileLogin {
 constructor(tg,onAuthorized){this.tg=tg;this.onAuthorized=onAuthorized;this.state='idle';this.error=null;this.pending=null;this.busy=false;}
 status(){return {state:this.state,error:this.error};}
 answer(value){if(!this.pending)throw Error('No login step is waiting');const p=this.pending;this.pending=null;p(String(value));}
 ask(state){this.state=state;return new Promise(resolve=>{this.pending=resolve;});}
 async start({apiId,apiHash,phone}){
  if(this.busy)throw Error('Finish the current Telegram login');
  if(this.tg.authorized)throw Error('Telegram is already connected');
  if(!Number.isSafeInteger(Number(apiId))||Number(apiId)<=0||!/^\w{32}$/.test(apiHash)||!/^\+?\d{7,16}$/.test(phone))throw Error('Enter valid Telegram API ID, API hash and phone number');
  this.busy=true;this.state='connecting';this.error=null;
  const cfg=this.tg.cfg;cfg.apiId=Number(apiId);cfg.apiHash=apiHash;
  await this.tg.close();
  const client=new TelegramClient(new StringSession(''),cfg.apiId,cfg.apiHash,{connectionRetries:3});client.setLogLevel('none');this.tg.client=client;
  this.task=(async()=>{try{
   await client.start({phoneNumber:async()=>phone,phoneCode:()=>this.ask('code'),password:()=>this.ask('password'),onError:e=>{this.error=String(e.errorMessage||e.message).slice(0,120);}});
   this.tg.authorized=true;this.tg.accountId=String((await client.getMe()).id);
   await writeFile(join(cfg.dir,'telegram.session'),client.session.save(),{mode:0o600});
   await writeFile(join(cfg.dir,'telegram-api.json'),JSON.stringify({apiId:cfg.apiId,apiHash:cfg.apiHash}),{mode:0o600});
   this.state='recovering';await this.onAuthorized();this.state='connected';
  }catch(e){this.state='error';this.error=String(e.errorMessage||e.message).slice(0,120);}finally{this.busy=false;this.pending=null;}})();
 }
}

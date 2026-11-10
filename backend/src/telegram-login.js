import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';
const cfg=config();if(!cfg.apiId||!cfg.apiHash)throw Error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH first');
const prompt=createInterface({input:stdin,output:stdout});const c=new TelegramClient(new StringSession(''),cfg.apiId,cfg.apiHash,{connectionRetries:3});c.setLogLevel('none');
try{await c.start({phoneNumber:()=>prompt.question('Telegram phone number (+country code): '),phoneCode:()=>prompt.question('Telegram login code: '),password:()=>prompt.question('Telegram 2FA password (terminal input is visible): '),onError:e=>console.error(e.message)});await mkdir(cfg.dir,{recursive:true,mode:0o700});await writeFile(join(cfg.dir,'telegram.session'),c.session.save(),{mode:0o600});console.log('Telegram connected. Session saved privately. Restart the backend.');}finally{prompt.close();await c.disconnect();}

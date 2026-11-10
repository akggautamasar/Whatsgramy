import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MobileLogin } from '../src/mobile-login.js';
const until=async(fn)=>{for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Login did not reach expected step');};
test('phone login handles code and password in memory, saves session and waits for recovery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wg-login-'));let restored=false;
 try{
  const fake={setLogLevel(){},session:{save:()=> 'test-session'},async getMe(){return {id:123};},async start(cb){assert.equal(await cb.phoneNumber(),'+919999999999');assert.equal(await cb.phoneCode(),'12345');assert.equal(await cb.password(),'secret');}};
  const tg={cfg:{dir},close:async()=>{},authorized:false};
  const login=new MobileLogin(tg,async()=>{restored=true;},()=>fake);
  await login.start({apiId:1234,apiHash:'a'.repeat(32),phone:'+919999999999'});
  await until(()=>login.state==='code');
  await assert.rejects(login.start({}),/Finish the current/);
  login.answer('12345');await until(()=>login.state==='password');login.answer('secret');await login.task;
  assert.equal(login.state,'connected');assert.equal(tg.accountId,'123');assert.equal(restored,true);assert.equal(login.pending,null);
  assert.equal(await readFile(join(dir,'telegram.session'),'utf8'),'test-session');
  const saved=await readFile(join(dir,'telegram-api.json'),'utf8');assert.equal(saved.includes('secret'),false);assert.equal(saved.includes('12345'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('phone login rejects missing credentials and unsolicited login answers',async()=>{
 const login=new MobileLogin({cfg:{}},async()=>{});
 await assert.rejects(login.start({apiId:0,apiHash:'bad',phone:'bad'}),/valid Telegram/);
 assert.throws(()=>login.answer('12345'),/No login step/);
});

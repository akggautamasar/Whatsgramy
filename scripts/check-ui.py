"""Seed only the disposable emulator, then verify populated native screens."""
import subprocess as sp,sqlite3,hashlib,time,json,urllib.request,xml.etree.ElementTree as ET,re,struct,zlib
PKG='com.whatsgramy.app'
def adb(*args):return sp.check_output(['adb',*args])
def shell(*args):return adb('shell',*args)
def screen(name):open(name,'wb').write(adb('exec-out','screencap','-p'))
def tree():
 shell('uiautomator','dump','/sdcard/wg-ui.xml')
 return ET.fromstring(adb('exec-out','cat','/sdcard/wg-ui.xml'))
def tap(label,timeout=20):
 end=time.time()+timeout
 while time.time()<end:
  root=tree()
  for n in root.iter('node'):
   if n.get('text')==label or n.get('content-desc')==label:
    x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')));shell('input','tap',str((x1+x2)//2),str((y1+y2)//2));time.sleep(2);return
  time.sleep(1)
 raise AssertionError('UI control not found: '+label)
def wait_text(value):
 for n in range(20):
  if any(value in x.get('text','') for x in tree().iter('node')):return
  if n in (3,7):shell('input','swipe','160','520','160','200','350')
  if n in (11,15):shell('input','swipe','160','200','160','520','350')
  time.sleep(1)
 raise AssertionError('UI text missing: '+value)
shell('am','force-stop',PKG)
base=['run-as',PKG]
open('ui-test.sqlite','wb').write(adb('exec-out',*base,'cat','files/engine/archive.sqlite'))
for suffix in ['-wal','-shm']:
 try:open('ui-test.sqlite'+suffix,'wb').write(adb('exec-out',*base,'cat','files/engine/archive.sqlite'+suffix))
 except sp.CalledProcessError:pass
# A deterministic local image, generated without an extra image dependency.
def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
pixels=b''.join(b'\x00'+b''.join(bytes((40+x//2,125+y,100+x//4)) for x in range(160)) for y in range(96))
photo=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',160,96,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(pixels))+chunk(b'IEND',b'')
open('ui-test.png','wb').write(photo)
now=int(time.time()*1000);chat='fixture-team@g.us';db=sqlite3.connect('ui-test.sqlite')
for i,name in enumerate(['Project team','Study circle','Family','Office updates','Reading club']):db.execute('INSERT OR REPLACE INTO chats VALUES(?,?,?)',(chat if i==0 else 'fixture-'+str(i),name,now-i*60000))
items=[('1'*64,'Campus-photo.png','image/png','photos','verified',len(photo),'files/engine/media/'+'1'*64,100),('2'*64,'Study-notes.pdf','application/pdf','documents','verified',245000,None,101),('3'*64,'Meeting-audio.ogg','audio/ogg','audio','downloaded',180000,'files/engine/media/'+'3'*64,None)]
appdir=shell(*base,'pwd').decode().strip()
for i,(id,name,mime,kind,status,size,path,tg) in enumerate(items):
 db.execute('INSERT OR REPLACE INTO media(id,chat_id,message_id,name,mime,kind,size,status,path,sha256,telegram_id,verified_at,created_at,uploaded_at,downloaded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(id,chat,'attachment-'+str(i),name,mime,kind,size,status,appdir+'/'+path if path else None,hashlib.sha256(photo).hexdigest() if i==0 else 'a'*64,tg,now if status=='verified' else None,now-300000,now-120000 if tg else None,now if path else None))
 db.execute('INSERT OR REPLACE INTO messages(id,chat_id,sender,text,timestamp,media_id,from_me) VALUES(?,?,?,?,?,?,?)',('fixture-m-'+str(i),chat,'Aditi','Here is the attachment.' if i==0 else '',now-200000+i*30000,id,0))
 db.execute('INSERT OR REPLACE INTO events VALUES(?,?,?,?,?,?)',('fixture-event-'+str(i),id,status,now-i*1000,size,None))
db.execute('INSERT OR REPLACE INTO messages(id,chat_id,sender,text,timestamp,media_id,from_me) VALUES(?,?,?,?,?,?,?)',('fixture-reply',chat,'You','Thanks, I can open these from Whatsgramy.',now-20000,None,1))
for i in range(1,5):db.execute('INSERT OR REPLACE INTO messages(id,chat_id,sender,text,timestamp,media_id,from_me) VALUES(?,?,?,?,?,?,?)',('fixture-chat-'+str(i),'fixture-'+str(i),'Member','The next update will be shared here.',now-i*60000,None,0))
# Exercise the installed app with the same archive size as the reported issue.
db.executemany(
 'INSERT INTO media(id,chat_id,message_id,name,mime,kind,size,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
 ((f'{10000+i:064x}', 'fixture-'+str(1+i%4), f'history-{i}', f'Old photo {i}.jpg',
   'image/jpeg', 'photos', 180000, 'queued', now-86400000-i) for i in range(5670)),
)
db.commit();db.execute('PRAGMA wal_checkpoint(TRUNCATE)');db.close()
adb('push','ui-test.sqlite','/data/local/tmp/wg-ui.sqlite');shell(*base,'rm','-f','files/engine/archive.sqlite-wal','files/engine/archive.sqlite-shm');shell(*base,'cp','/data/local/tmp/wg-ui.sqlite','files/engine/archive.sqlite')
adb('push','ui-test.png','/data/local/tmp/wg-ui.png');shell(*base,'mkdir','-p','files/engine/media');shell(*base,'cp','/data/local/tmp/wg-ui.png','files/engine/media/'+'1'*64);shell(*base,'cp','/data/local/tmp/wg-ui.png','files/engine/media/'+'3'*64)
shell('am','start','-W','-n',PKG+'/.MainActivity');wait_text('Project team');screen('whatsgramy-chats.png')
tap('Project team');wait_text('Thanks, I can open');wait_text('Saved to Telegram');screen('whatsgramy-conversation.png')
shell('input','keyevent','4');time.sleep(1);tap('Files');wait_text('Campus-photo.png');wait_text('Not on phone');wait_text('Available on this phone');screen('whatsgramy-files.png')
tap('Transfers');wait_text('saved to Telegram');screen('whatsgramy-transfers.png')
tap('Settings');wait_text('Automatic backup');screen('whatsgramy-settings.png')
tap('Files');wait_text('Campus-photo.png')
pid=shell('pidof',PKG+':engine').decode().strip()
if not pid:raise AssertionError('Archive engine was not running before offline test')
shell(*base,'kill',pid)
wait_text('showing last loaded data');tap('Campus-photo.png');wait_text('available on phone');screen('whatsgramy-local-offline.png')
print('Populated chat, file-state, transfer and offline local opening checks passed (synthetic emulator data only).')

#!/usr/bin/env bash
set -euo pipefail
trap 'adb logcat -d > engine-logcat.txt; adb shell run-as com.whatsgramy.app cat files/engine-error.txt > engine-error.txt 2>/dev/null || true' EXIT
adb install --no-streaming apk/app-debug.apk
adb shell pm grant com.whatsgramy.app android.permission.POST_NOTIFICATIONS
adb shell am start -W -n com.whatsgramy.app/.MainActivity
adb forward tcp:18787 tcp:8787
for attempt in $(seq 1 90); do curl -fsS http://127.0.0.1:18787/health && break || sleep 2; done
curl --fail http://127.0.0.1:18787/health
adb shell run-as com.whatsgramy.app cat files/engine/ready.json > runtime.json
python3 - <<'PY'
import json,subprocess,urllib.request,urllib.error,time
runtime=json.load(open('runtime.json'))
assert runtime['sqlite'] and runtime['phoneOnly'] and runtime['node'].startswith('v24.')
cfg=json.loads(subprocess.check_output(['adb','shell','run-as','com.whatsgramy.app','cat','files/engine/engine.json']))
def request(path,body=None,authorized=True):
 headers={'Content-Type':'application/json'}
 if authorized:headers['Authorization']='Bearer '+cfg['token']
 req=urllib.request.Request('http://127.0.0.1:18787'+path,headers=headers,data=json.dumps(body).encode() if body is not None else None,method='PUT' if body is not None else 'GET')
 return json.load(urllib.request.urlopen(req,timeout=5))
try:request('/api/status',authorized=False);raise AssertionError('Unauthenticated access allowed')
except urllib.error.HTTPError as e:assert e.code==401
assert request('/api/settings',{'retentionDays':17})['retentionDays']==17
subprocess.run(['adb','shell','am','force-stop','com.whatsgramy.app'],check=True)
subprocess.run(['adb','shell','am','start','-W','-n','com.whatsgramy.app/.MainActivity'],check=True)
for n in range(60):
 try:
  assert request('/api/settings')['retentionDays']==17
  break
 except OSError:time.sleep(1)
else:raise AssertionError('Engine failed to restart')
print('Embedded Android engine: SQLite, authentication and settings persistence passed')
PY
adb shell pidof com.whatsgramy.app
adb exec-out screencap -p > whatsgramy-start.png
adb logcat -d -b crash > crash.log
if grep -q 'FATAL EXCEPTION' crash.log; then cat crash.log; exit 1; fi

package com.whatsgramy.app

import android.app.*
import android.content.*
import android.os.*
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

class EngineService:Service(){
    external fun startNode(script:String,directory:String):Int
    private var started=false
    override fun onBind(intent:Intent?) : IBinder? = null
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        val manager=getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("archive","Archive engine",NotificationManager.IMPORTANCE_LOW))
        val pending=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE)
        startForeground(1,Notification.Builder(this,"archive").setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("Whatsgramy archive is running").setContentText("WhatsApp and Telegram connect on this phone").setContentIntent(pending).build())
        if(!started){started=true;Thread {
            try {
                val bundle=File(filesDir,"engine-bundle");val revision=BuildConfig.VERSION_CODE.toString()
                if(File(bundle,"revision").readTextOrNull()!=revision){bundle.deleteRecursively();copyAsset("engine",bundle);File(bundle,"revision").writeText(revision)}
                val dir=File(filesDir,"engine").apply{mkdirs()};File(dir,"ready.json").delete()
                System.loadLibrary("node");System.loadLibrary("engine")
                startNode(File(bundle,"src/mobile-entry.js").path,dir.path)
            }catch(e:Throwable){File(filesDir,"engine-error.txt").writeText(e.toString())}
            stopSelf();android.os.Process.killProcess(android.os.Process.myPid())
        }.start()}
        return START_NOT_STICKY
    }
    private fun File.readTextOrNull()=if(exists())readText()else null
    private fun copyAsset(path:String,dest:File){val children=assets.list(path)?:emptyArray();if(children.isEmpty()){dest.parentFile?.mkdirs();assets.open(path).use{input->dest.outputStream().use{input.copyTo(it)}}}else{dest.mkdirs();children.forEach{copyAsset("$path/$it",File(dest,it))}}}
    override fun onTimeout(startId:Int,fgsType:Int){stopSelf();android.os.Process.killProcess(android.os.Process.myPid())}
    override fun onDestroy(){super.onDestroy();android.os.Process.killProcess(android.os.Process.myPid())}
    companion object {
        fun prepare(context:Context){
            val dir=File(context.filesDir,"engine").apply{mkdirs()};val file=File(dir,"engine.json")
            if(!file.exists()){fun random():String {val b=ByteArray(32);SecureRandom().nextBytes(b);return b.joinToString(""){"%02x".format(it)}};file.writeText(JSONObject().put("token",random()).put("indexKey",random()).toString())}
            val token=JSONObject(file.readText()).getString("token");Connection(context).save("http://127.0.0.1:8787",token)
        }
        fun start(context:Context){context.getSharedPreferences("engine-controls",Context.MODE_PRIVATE).edit().putBoolean("enabled",true).apply();prepare(context);context.startForegroundService(Intent(context,EngineService::class.java))}
    }
}

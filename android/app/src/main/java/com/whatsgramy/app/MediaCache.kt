package com.whatsgramy.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

private object Downloads { val locks=ConcurrentHashMap<String,Any>() }
class MediaCache(private val context: Context): SQLiteOpenHelper(context,"local-media.db",null,1) {
    override fun onCreate(db: SQLiteDatabase){db.execSQL("CREATE TABLE media(id TEXT PRIMARY KEY,path TEXT,downloaded INTEGER NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,sha TEXT NOT NULL)")}
    override fun onUpgrade(db: SQLiteDatabase,old: Int,new: Int){}
    private val root: File get()=File(context.getExternalFilesDir(null)?:context.filesDir,"Whatsgramy/Media").apply { mkdirs() }
    fun seen(id: String)=readableDatabase.rawQuery("SELECT id FROM media WHERE id=?",arrayOf(id)).use { it.moveToFirst() }
    fun local(id: String): File?=readableDatabase.rawQuery("SELECT path FROM media WHERE id=?",arrayOf(id)).use { if(it.moveToFirst()&&!it.isNull(0))File(it.getString(0)).takeIf { f->f.isFile } else null }
    fun pinned(id: String)=readableDatabase.rawQuery("SELECT pinned FROM media WHERE id=?",arrayOf(id)).use { it.moveToFirst()&&it.getInt(0)==1 }
    fun pin(id: String,value: Boolean){writableDatabase.execSQL("UPDATE media SET pinned=? WHERE id=?",arrayOf(if(value)1 else 0,id))}
    fun delete(id: String){synchronized(Downloads.locks.getOrPut(id){Any()}){local(id)?.let { check(it.delete()) { "Could not delete the local copy" } };writableDatabase.execSQL("UPDATE media SET path=NULL WHERE id=?",arrayOf(id))}}
    fun cleanup(days: Int){val cutoff=System.currentTimeMillis()-days.coerceIn(1,365)*86400000L;val ids=readableDatabase.rawQuery("SELECT id FROM media WHERE path IS NOT NULL AND pinned=0 AND downloaded<=?",arrayOf(cutoff.toString())).use { c->buildList { while(c.moveToNext())add(c.getString(0)) } };ids.forEach(::delete)}
    fun folder()=root.absolutePath
    fun bytes(): Long=root.listFiles().orEmpty().filter { !it.name.endsWith(".part") }.sumOf { it.length() }
    fun ensure(item: JSONObject): File {
        val id=item.optString("media_id").ifBlank { item.getString("id") }
        require(id.matches(Regex("[a-f0-9]{64}"))) { "Invalid attachment ID" }
        require(item.optString("status")=="verified" && item.optLong("verified_at",0)>0) { "Wait until Telegram verification finishes" }
        val sha=item.optString("sha256");require(sha.matches(Regex("[a-f0-9]{64}"))) { "Wait until the Telegram backup is verified" }
        synchronized(Downloads.locks.getOrPut(id){Any()}){
            local(id)?.let { return it }
            val extension=item.optString("name").substringAfterLast('.',"").take(12).filter { it.isLetterOrDigit() }
            val file=File(root,id+if(extension.isBlank())"" else ".$extension");val part=File(root,"$id.part")
            val expected=item.optLong("size",0)
            require(root.usableSpace>maxOf(16L*1024*1024,expected-part.length())) { "Not enough free space for this attachment" }
            val api=Api(context);val offset=if(part.isFile)part.length() else 0L
            val req=api.request("/api/media/$id/file").apply { if(offset>0)header("Range","bytes=$offset-") }.build()
            api.client.newCall(req).execute().use { response->
                if(response.code==416){part.delete();error("Partial download expired; tap again to retry")}
                check(response.isSuccessful) { "Download failed (${response.code}); your Telegram backup is kept" }
                val append=offset>0&&response.code==206
                response.body?.byteStream()?.use { input->java.io.FileOutputStream(part,append).use { output->input.copyTo(output,1024*1024);output.fd.sync() } }?:error("Empty response")
            }
            val digest=MessageDigest.getInstance("SHA-256");part.inputStream().use { input->val b=ByteArray(1024*1024);while(true){val n=input.read(b);if(n<0)break;digest.update(b,0,n)} }
            val actual=digest.digest().joinToString(""){"%02x".format(it)}
            if(actual!=sha){part.delete();error("Download verification failed; tap to retry")}
            check(part.renameTo(file)) { "Could not save the attachment" }
            writableDatabase.execSQL("INSERT INTO media(id,path,downloaded,pinned,sha) VALUES(?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,downloaded=excluded.downloaded,sha=excluded.sha",arrayOf(id,file.absolutePath,System.currentTimeMillis(),sha))
            return file
        }
    }
}
class ArchiveSync(context: Context,params: WorkerParameters):CoroutineWorker(context,params){
    override suspend fun doWork():Result=withContext(Dispatchers.IO){
        val cfg=Connection(applicationContext);if(cfg.url.isBlank())return@withContext Result.success()
        val cache=MediaCache(applicationContext)
        try{val api=Api(applicationContext);val s=api.json("/api/settings");if(!s.optBoolean("enabled"))return@withContext Result.success()
            if(cfg.cleanup&&s.optBoolean("autoCleanup"))cache.cleanup(s.optInt("retentionDays",15))
            if(cfg.autoDownload&&s.optBoolean("autoDownload")){
                var cursor=0L
                while(!isStopped){val list=api.json("/api/media",query=mapOf("cursor" to cursor.toString(),"limit" to "100")).getJSONArray("items");if(list.length()==0)break
                    for(i in 0 until list.length()){if(isStopped)break;val m=list.getJSONObject(i);cursor=m.getLong("cursor");if(m.optString("status")=="verified"&&s.optBoolean(m.optString("kind"),true)&&!cache.seen(m.getString("id")))cache.ensure(m)}
                }
            };Result.success()
        }catch(_:Exception){Result.retry()}finally{cache.close()}
    }
    companion object {
        fun schedule(context: Context){val cfg=Connection(context);val manager=WorkManager.getInstance(context);if(cfg.url.isBlank()){manager.cancelUniqueWork("archive-sync");return};val constraints=Constraints.Builder().setRequiredNetworkType(if(cfg.wifiOnly)NetworkType.UNMETERED else NetworkType.CONNECTED).setRequiresStorageNotLow(true).build();manager.enqueueUniquePeriodicWork("archive-sync",ExistingPeriodicWorkPolicy.UPDATE,PeriodicWorkRequestBuilder<ArchiveSync>(15,TimeUnit.MINUTES).setConstraints(constraints).build())}
        fun now(context:Context){val cfg=Connection(context);val constraints=Constraints.Builder().setRequiredNetworkType(if(cfg.wifiOnly)NetworkType.UNMETERED else NetworkType.CONNECTED).setRequiresStorageNotLow(true).build();WorkManager.getInstance(context).enqueueUniqueWork("archive-sync-now",ExistingWorkPolicy.KEEP,OneTimeWorkRequestBuilder<ArchiveSync>().setConstraints(constraints).build())}
    }
}

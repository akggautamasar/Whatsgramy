package com.whatsgramy.app

import android.app.AlertDialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.text.InputType
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.text.DateFormat
import java.util.Date

class MainActivity:ComponentActivity(){
    private lateinit var root:LinearLayout
    private lateinit var body:LinearLayout
    private lateinit var title:TextView
    private lateinit var subtitle:TextView
    private lateinit var cfg:Connection
    private var generation=0
    private var back:(()->Unit)?=null
    private var currentMedia:MediaPlayerView?=null
    private val green=Color.rgb(7,94,84)
    override fun onCreate(state:Bundle?){super.onCreate(state);cfg=Connection(this)
        root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setBackgroundColor(Color.rgb(245,247,246))}
        root.setOnApplyWindowInsetsListener { v,insets->v.setPadding(insets.systemWindowInsetLeft,insets.systemWindowInsetTop,insets.systemWindowInsetRight,insets.systemWindowInsetBottom);insets }
        setContentView(root)
        onBackPressedDispatcher.addCallback(this,object:OnBackPressedCallback(true){override fun handleOnBackPressed(){back?.invoke()?:finish()}})
        ArchiveSync.schedule(this)
        if(cfg.url.isBlank())showSettings()else showChats()
    }
    override fun onDestroy(){currentMedia?.stop();super.onDestroy()}
    private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
    private fun text(value:String,size:Float=16f,bold:Boolean=false)=TextView(this).apply{text=value;textSize=size;setTextColor(Color.rgb(27,43,39));if(bold)setTypeface(typeface,Typeface.BOLD);setPadding(dp(6),dp(6),dp(6),dp(6))}
    private fun button(label:String,action:()->Unit)=Button(this).apply{text=label;isAllCaps=false;setOnClickListener{action()}}
    private fun rounded(color:Int)=GradientDrawable().apply{setColor(color);cornerRadius=dp(14).toFloat()}
    private fun card(parent:LinearLayout=body):LinearLayout=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(12),dp(10),dp(12),dp(10));background=rounded(Color.WHITE);parent.addView(this,LinearLayout.LayoutParams(-1,-2).apply{setMargins(dp(12),dp(6),dp(12),dp(6))})}
    private fun page(name:String,description:String="",onBack:(()->Unit)?=null){generation++;currentMedia?.stop();currentMedia=null;back=onBack;root.removeAllViews()
        val bar=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL;setPadding(dp(12),dp(8),dp(12),dp(8));setBackgroundColor(green)}
        if(onBack!=null)bar.addView(button("‹"){onBack()}.apply{contentDescription="Back"},LinearLayout.LayoutParams(dp(48),dp(48)))
        val headings=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL};title=text(name,23f,true).apply{setTextColor(Color.WHITE)};subtitle=text(description,12f).apply{setTextColor(Color.rgb(198,232,223))};headings.addView(title);headings.addView(subtitle);bar.addView(headings,LinearLayout.LayoutParams(0,-2,1f));root.addView(bar)
        val scroll=ScrollView(this);body=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(0,dp(10),0,dp(16))};scroll.addView(body);root.addView(scroll,LinearLayout.LayoutParams(-1,0,1f))
        val tabs=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;setBackgroundColor(Color.WHITE)}
        listOf("Chats" to {showChats()},"Files" to {showFiles()},"Settings" to {showSettings()}).forEach{(name,action)->tabs.addView(button(name,action),LinearLayout.LayoutParams(0,dp(52),1f))};root.addView(tabs)
    }
    private fun runWork(action:suspend()->Unit){val g=generation;lifecycleScope.launch{try{action()}catch(e:Exception){if(g==generation)Toast.makeText(this@MainActivity,e.message?:"Connection failed",Toast.LENGTH_LONG).show()}}}
    private suspend fun request(path:String,method:String="GET",body:JSONObject?=null,query:Map<String,String> = emptyMap())=withContext(Dispatchers.IO){Api(this@MainActivity).json(path,method,body,query)}
    private fun formatSize(n:Long)=when{n>=1_000_000_000->"%.1f GB".format(n/1e9);n>=1_000_000->"%.1f MB".format(n/1e6);n>=1000->"%.0f KB".format(n/1e3);else->"$n B"}
    private fun showChats(){if(cfg.url.isBlank()){showSettings();return};page("Whatsgramy","Your conversations. Your attachment archive.")
        val head=card();head.addView(text("Attachment archive",18f,true));head.addView(text("Files remain available here after their device copies are removed.",14f));head.addView(button("Refresh chats"){showChats()})
        val g=generation;runWork{val summary=request("/api/status").getJSONObject("stats");val result=request("/api/chats").getJSONArray("items");if(g!=generation)return@runWork;head.addView(text("${summary.optInt("uploaded")} uploaded · ${summary.optInt("verified")} verified · ${summary.optInt("pending")} pending · ${summary.optInt("failed")} failed",14f,true));head.addView(text("${formatSize(summary.optLong("uploaded_bytes"))} archived · ${summary.optInt("unique_verified_files")} unique verified files",12f));head.addView(button("Upload history"){showHistory()})
            if(result.length()==0)card().addView(text("No synced chats yet. Link WhatsApp in Settings, then receive an ordinary attachment. Older history depends on WhatsApp availability."))
            for(i in 0 until result.length()){val c=result.getJSONObject(i);val row=card();row.addView(text(c.optString("title",c.optString("id")),17f,true));row.addView(text(c.optString("preview").ifBlank{"${c.optInt("files")} attachments"},14f));row.setOnClickListener{showChat(c.getString("id"),c.optString("title"))}}
        }
    }
    private fun showChat(id:String,name:String,before:Long=Long.MAX_VALUE,older:Boolean=false){page(name,"Read-only archive · tap an attachment to open",{showChats()});val g=generation
        runWork{val result=request("/api/messages",query=mapOf("chat" to id,"before" to before.toString())).getJSONArray("items");if(g!=generation)return@runWork
            if(result.length()==0)card().addView(text("No messages available in this part of the archive."))
            if(result.length()==100){val oldest=result.getJSONObject(result.length()-1).getLong("timestamp");body.addView(button("Earlier messages"){showChat(id,name,oldest,true)})}
            for(i in result.length()-1 downTo 0){val m=result.getJSONObject(i);val row=card();row.background=rounded(Color.rgb(228,245,235));row.addView(text(m.optString("sender"),12f,true));val content=m.optString("text");if(content.isNotBlank())row.addView(text(content));row.addView(text(DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT).format(Date(m.getLong("timestamp"))),11f));if(!m.isNull("media_id")){attachment(row,m){showChat(id,name)}}}
        }
    }
    private fun attachment(row:LinearLayout,m:JSONObject,returnTo:()->Unit){val id=m.optString("media_id").ifBlank{m.getString("id")};val cache=MediaCache(this);val local=cache.local(id)!=null;cache.close();row.addView(text(m.optString("name","Attachment"),16f,true));row.addView(text("${formatSize(m.optLong("size"))} · ${if(local)"On this phone" else if(m.optString("status")=="verified")"In Telegram" else m.optString("status","queued")}",12f))
        row.addView(button(if(local)"Open file"else"Open from Telegram"){open(m,returnTo)}.apply{isEnabled=m.optString("status")=="verified"})
        if(m.optString("status")=="failed")row.addView(button("Retry backup"){runWork{request("/api/media/$id/retry","POST");returnTo()}})
        row.addView(button("File details"){fun date(key:String):String=if(m.optLong(key,0)>0)DateFormat.getDateTimeInstance().format(Date(m.getLong(key)))else "Not recorded"
            AlertDialog.Builder(this).setTitle(m.optString("name")).setMessage("Status: ${m.optString("status")}\nSize: ${formatSize(m.optLong("size"))}\nDiscovered: ${date("created_at")}\nUploaded: ${date("uploaded_at")}\nVerified: ${date("verified_at")}\nTelegram message: ${m.optString("telegram_id")}\nSHA-256: ${m.optString("sha256")}").setPositiveButton("OK",null).show()})
        row.setOnLongClickListener{val cache2=MediaCache(this);val pinned=cache2.pinned(id);cache2.close();AlertDialog.Builder(this).setTitle(m.optString("name")).setItems(arrayOf(if(pinned)"Allow local cleanup"else"Keep local copy", "Delete this phone's copy")){_,which->
            if(which==0){runWork{withContext(Dispatchers.IO){MediaCache(this@MainActivity).use{if(!pinned)it.ensure(m);it.pin(id,!pinned)}};Toast.makeText(this@MainActivity,"Local retention preference saved",Toast.LENGTH_SHORT).show()}}
            else AlertDialog.Builder(this).setTitle("Remove local copy?").setMessage("The verified Telegram backup and chat entry are kept. Tap the attachment later to download it again.").setNegativeButton("Cancel",null).setPositiveButton("Delete local"){_,_->runWork{withContext(Dispatchers.IO){MediaCache(this@MainActivity).use{it.delete(id)}};returnTo()}}.show()
        }.show();true}
    }
    private fun showFiles(query:String="",cursor:Long=0){page("Files","Photos, videos, PDFs and other attachments")
        val search=EditText(this).apply{hint="Search filenames";setText(query);setSingleLine()};val controls=card();controls.addView(search);controls.addView(button("Search"){showFiles(search.text.toString())});controls.addView(button("Sync phone downloads"){ArchiveSync.now(this);Toast.makeText(this,"Download sync queued using your network settings",Toast.LENGTH_LONG).show()})
        val g=generation;runWork{val items=request("/api/media",query=mapOf("q" to query,"cursor" to cursor.toString(),"limit" to "100")).getJSONArray("items");if(g!=generation)return@runWork;if(items.length()==0)card().addView(text("No archived attachments here yet."));for(i in 0 until items.length())attachment(card(),items.getJSONObject(i)){showFiles(query,cursor)};if(items.length()==100)body.addView(button("Next files"){showFiles(query,items.getJSONObject(items.length()-1).getLong("cursor"))})}
    }
    private fun switch(parent:LinearLayout,label:String,detail:String,checked:Boolean,changed:(Boolean)->Unit){parent.addView(Switch(this).apply{text=label;isChecked=checked;setPadding(dp(6),dp(8),dp(6),dp(8));setOnCheckedChangeListener{_,v->changed(v)}});if(detail.isNotBlank())parent.addView(text(detail,12f))}
    private fun showSettings(){page("Settings","Everything is under your control")
        val connect=card();connect.addView(text("Private backend",18f,true));val url=EditText(this).apply{hint="https://your-backend.example.com";setText(cfg.url);inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI;setSingleLine()};val token=EditText(this).apply{hint="64-character API token";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD;setSingleLine()};connect.addView(url);connect.addView(token);connect.addView(button("Save connection"){try{cfg.save(url.text.toString(),token.text.toString());ArchiveSync.schedule(this);showSettings()}catch(e:Exception){Toast.makeText(this,e.message,Toast.LENGTH_LONG).show()}})
        if(cfg.url.isBlank()){connect.addView(text("Run the private backend first. The repository README has the setup commands. This app does not connect to a public service."));return}
        val phone=card();phone.addView(text("This phone",18f,true));switch(phone,"Download archived attachments automatically","Runs periodically while Android allows background work.",cfg.autoDownload){cfg.autoDownload=it;ArchiveSync.schedule(this)};switch(phone,"Wi-Fi only for automatic downloads","Manual opening can use your current connection.",cfg.wifiOnly){cfg.wifiOnly=it;ArchiveSync.schedule(this)};switch(phone,"Clean up this phone's local copies","Uses the archive retention period. Pinned copies are kept.",cfg.cleanup){cfg.cleanup=it}
        MediaCache(this).use{phone.addView(text("Local cache: ${it.fileCount()} files · ${formatSize(it.bytes())}\nFolder: ${it.folder()}",12f))}
        val g=generation;runWork{val status=request("/api/status");if(g!=generation)return@runWork
            val accounts=card();accounts.addView(text("Connections",18f,true));val wa=status.getJSONObject("whatsapp");accounts.addView(text("WhatsApp: ${wa.optString("connection")}\nTelegram: ${if(status.getJSONObject("telegram").optBoolean("connected"))"connected"else"not connected"}"));if(!status.getJSONObject("telegram").optBoolean("connected"))accounts.addView(text("On your private server, run npm run telegram:login, then restart the backend. Your Telegram session stays on that server.",13f))
            accounts.addView(button("Connect / refresh WhatsApp"){runWork{request("/api/whatsapp/start","POST");showSettings()}})
            val number=EditText(this).apply{hint="WhatsApp number with country code, digits only";inputType=InputType.TYPE_CLASS_PHONE};accounts.addView(number);accounts.addView(button("Get pairing code"){runWork{val response=request("/api/whatsapp/pair","POST",JSONObject().put("phone",number.text.toString().filter{it.isDigit()}));AlertDialog.Builder(this@MainActivity).setTitle("Link Whatsgramy").setMessage("In WhatsApp → Linked devices → Link a device → Link with phone number, enter:\n\n${response.getString("code")}").setPositiveButton("OK",null).show()}})
            val qr=wa.optString("qr");if(qr.startsWith("data:image")){val bytes=Base64.decode(qr.substringAfter(','),Base64.DEFAULT);accounts.addView(ImageView(this@MainActivity).apply{setImageBitmap(BitmapFactory.decodeByteArray(bytes,0,bytes.size));adjustViewBounds=true},LinearLayout.LayoutParams(-1,dp(260)));accounts.addView(text("Scan from WhatsApp → Linked devices using another screen, or use the pairing code above.",12f))}
            val settings=status.getJSONObject("settings");val archive=card();archive.addView(text("Archive controls",18f,true))
            val entries=listOf(Triple("enabled","Enable archive","Stops new archive transfers and automatic cleanup when off."),Triple("autoDownload","Capture WhatsApp attachments","Download available incoming attachments into the separate archive."),Triple("autoUpload","Upload to Telegram","Local files are retained until verification succeeds."),Triple("cloudOpen","Retrieve missing files from Telegram","Allow on-demand opening in Whatsgramy."),Triple("autoMetadata","Automatic recovery index backup","Save file references, counts, history and Settings to your Telegram Saved Messages."),Triple("autoCleanup","Automatic local cleanup","Only verified, indexed copies are eligible; originals in official WhatsApp are untouched."),Triple("photos","Photos",""),Triple("videos","Videos",""),Triple("audio","Audio and voice notes",""),Triple("documents","PDFs and documents",""),Triple("other","Other files and stickers",""))
            entries.forEach{(key,label,detail)->switch(archive,label,detail,settings.optBoolean(key)){value->runWork{try{request("/api/settings","PUT",JSONObject().put(key,value));ArchiveSync.schedule(this@MainActivity)}catch(e:Exception){showSettings();throw e}}}}
            val days=EditText(this@MainActivity).apply{hint="Retention days";inputType=InputType.TYPE_CLASS_NUMBER;setText(settings.optInt("retentionDays",15).toString())};archive.addView(days);archive.addView(button("Save retention period"){runWork{val n=days.text.toString().toIntOrNull()?:error("Enter 1–365 days");request("/api/settings","PUT",JSONObject().put("retentionDays",n));showSettings()}})
            val health=card();val stats=status.getJSONObject("stats");val metadata=status.optJSONObject("metadata")?:JSONObject();health.addView(text("Metadata recovery: ${metadata.optString("recovery_status","not checked")}\nLast index backup: ${if(metadata.optLong("last_backup_at",0)>0)DateFormat.getDateTimeInstance().format(Date(metadata.getLong("last_backup_at")))else "Not backed up yet"}",13f));if(!metadata.isNull("error")&&metadata.optString("error").isNotBlank())health.addView(text(metadata.optString("error"),12f));health.addView(text("${stats.optInt("uploaded")} uploaded · ${formatSize(stats.optLong("uploaded_bytes"))}\n${stats.optInt("pending")} pending · ${stats.optInt("needs_source")} need their original source",14f));val types=stats.optJSONObject("by_type")?:JSONObject();types.keys().forEach{kind->val type=types.getJSONObject(kind);health.addView(text("${kind.replaceFirstChar{it.uppercase()}}: ${type.optInt("verified")} verified / ${type.optInt("total")} · ${formatSize(type.optLong("bytes"))}",12f))};health.addView(button("View upload history"){showHistory()});health.addView(text("${stats.optInt("verified")} verified · ${stats.optInt("failed")} failed · ${stats.optInt("total")} attachments",15f,true));health.addView(button("Back up recovery index now"){runWork{request("/api/index/backup","POST");Toast.makeText(this@MainActivity,"Recovery index backed up",Toast.LENGTH_SHORT).show()}});health.addView(text("This is an unofficial linked-device archive. Account pairing and historical media depend on WhatsApp. View-once and disappearing messages are excluded. The app does not send chat messages.",12f))
        }
    }
    private fun showHistory(before:Long=Long.MAX_VALUE){page("Upload history","Uploads, verification, retries and local cleanup",{showChats()});val g=generation;runWork{val list=request("/api/history",query=mapOf("before" to before.toString(),"limit" to "100")).getJSONArray("items");if(g!=generation)return@runWork;if(list.length()==0)card().addView(text("No recorded archive activity yet."));for(i in 0 until list.length()){val event=list.getJSONObject(i);val row=card();row.addView(text(event.optString("type").replace('_',' '),15f,true));row.addView(text(event.optString("name").takeUnless{it=="null"}?:"Archive activity",14f));row.addView(text("${DateFormat.getDateTimeInstance().format(Date(event.getLong("timestamp")))} · ${formatSize(event.optLong("bytes"))}",12f));if(!event.isNull("detail"))row.addView(text(event.optString("detail"),12f))};if(list.length()==100)body.addView(button("Earlier activity"){showHistory(list.getJSONObject(list.length()-1).getLong("timestamp"))})}}
    private fun open(item:JSONObject,returnTo:()->Unit){page(item.optString("name","Attachment"),"Downloading and verifying…",returnTo);val g=generation;runWork{val file=withContext(Dispatchers.IO){MediaCache(this@MainActivity).use{it.ensure(item)}};if(g!=generation)return@runWork;subtitle.text="Verified file · long-press an attachment to manage its local copy";val mime=item.optString("mime");when{
        mime.startsWith("image/")->body.addView(ImageView(this@MainActivity).apply{adjustViewBounds=true;setImageBitmap(withContext(Dispatchers.IO){val o=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeFile(file.path,o);o.inSampleSize=maxOf(1,maxOf(o.outWidth,o.outHeight)/2000);o.inJustDecodeBounds=false;BitmapFactory.decodeFile(file.path,o)})},LinearLayout.LayoutParams(-1,-2))
        mime.startsWith("video/")||mime.startsWith("audio/")-> {val v=MediaPlayerView(this@MainActivity,file);currentMedia=v;body.addView(v,LinearLayout.LayoutParams(-1,dp(if(mime.startsWith("audio/"))180 else 340)))}
        mime=="application/pdf"||file.extension.equals("pdf",true)->showPdf(file,0)
        mime.startsWith("text/")->body.addView(text(withContext(Dispatchers.IO){file.inputStream().bufferedReader().use{reader->val chars=CharArray(200000);val n=reader.read(chars);if(n>0)String(chars,0,n)else ""}}))
        else->card().addView(text("The file is downloaded and verified. A built-in preview for this format is not available in version 0.1.0. It remains in Whatsgramy's separate folder."))
    }}}
    private fun showPdf(file:File,index:Int){val holder=card();holder.addView(text("Rendering PDF…"));val g=generation;runWork{val result=withContext(Dispatchers.IO){ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY).use{fd->PdfRenderer(fd).use{renderer->renderer.openPage(index.coerceIn(0,renderer.pageCount-1)).use{p->val w=minOf(1600,maxOf(600,resources.displayMetrics.widthPixels));val bitmap=Bitmap.createBitmap(w,(w.toFloat()*p.height/p.width).toInt().coerceAtLeast(1),Bitmap.Config.ARGB_8888);bitmap.eraseColor(Color.WHITE);p.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);bitmap to renderer.pageCount}}}};if(g!=generation){result.first.recycle();return@runWork};holder.removeAllViews();holder.addView(text("Page ${index+1} of ${result.second}",14f,true));holder.addView(ImageView(this@MainActivity).apply{adjustViewBounds=true;setImageBitmap(result.first)},LinearLayout.LayoutParams(-1,-2));val controls=LinearLayout(this@MainActivity);if(index>0)controls.addView(button("Previous"){body.removeView(holder);showPdf(file,index-1)});if(index+1<result.second)controls.addView(button("Next"){body.removeView(holder);showPdf(file,index+1)});holder.addView(controls)}}
}
class MediaPlayerView(context:Context,file:File):FrameLayout(context){private val video=VideoView(context);init{addView(video,LayoutParams(-1,-1));val controller=MediaController(context);controller.setAnchorView(video);video.setMediaController(controller);video.setVideoPath(file.path);video.setOnPreparedListener{video.start()};video.setOnErrorListener{_,_,_->Toast.makeText(context,"This device cannot decode the media format",Toast.LENGTH_LONG).show();true}};fun stop(){video.stopPlayback()}}

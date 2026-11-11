package com.whatsgramy.app
import android.content.Context
import android.graphics.*
import android.graphics.drawable.Drawable
import android.view.View
class ArchiveIcon(context:Context,private val kind:String,private val tint:Int):View(context){
 override fun onDraw(c:Canvas){super.onDraw(c);val s=minOf(width,height)/24f;c.save();c.translate((width-24*s)/2,(height-24*s)/2);c.scale(s,s);val p=Paint(Paint.ANTI_ALIAS_FLAG).apply{color=tint;style=Paint.Style.STROKE;strokeWidth=1.8f;strokeCap=Paint.Cap.ROUND;strokeJoin=Paint.Join.ROUND};fun line(x:Float,y:Float,a:Float,b:Float)=c.drawLine(x,y,a,b,p)
 when(kind){
 "Back"->{line(19f,12f,5f,12f);line(5f,12f,11f,6f);line(5f,12f,11f,18f)}
 "Refresh"->{c.drawArc(4f,4f,20f,20f,40f,285f,false,p);line(20f,4f,20f,10f);line(20f,10f,14f,10f)}
 "Chats"->{c.drawRoundRect(3f,3f,21f,18f,5f,5f,p);val path=Path().apply{moveTo(7f,18f);lineTo(4f,21f);lineTo(4f,15f)};c.drawPath(path,p);line(7f,8f,17f,8f);line(7f,12f,14f,12f)}
 "Transfers","Download"->{line(8f,3f,8f,17f);line(4f,13f,8f,17f);line(8f,17f,12f,13f);line(16f,21f,16f,7f);line(12f,11f,16f,7f);line(16f,7f,20f,11f)}
 "Open"->{c.drawCircle(12f,12f,9f,p);line(10f,7f,16f,12f);line(16f,12f,10f,17f)}
 "Settings"->{c.drawCircle(12f,12f,4f,p);c.drawCircle(12f,12f,8f,p);for(i in 0..7){val a=i*Math.PI/4;line((12+8*kotlin.math.cos(a)).toFloat(),(12+8*kotlin.math.sin(a)).toFloat(),(12+11*kotlin.math.cos(a)).toFloat(),(12+11*kotlin.math.sin(a)).toFloat())}}
 "Photo"->{c.drawRoundRect(3f,3f,21f,21f,3f,3f,p);c.drawCircle(16f,8f,2f,p);val path=Path().apply{moveTo(4f,18f);lineTo(9f,11f);lineTo(14f,17f);lineTo(17f,13f);lineTo(21f,18f)};c.drawPath(path,p)}
 "Video"->{c.drawRoundRect(2f,5f,17f,19f,3f,3f,p);val path=Path().apply{moveTo(17f,9f);lineTo(22f,6f);lineTo(22f,18f);lineTo(17f,15f)};c.drawPath(path,p)}
 "Audio"->{c.drawRoundRect(9f,2f,15f,15f,3f,3f,p);c.drawArc(5f,5f,19f,19f,0f,180f,false,p);line(12f,19f,12f,22f);line(8f,22f,16f,22f)}
 "Info"->{c.drawCircle(12f,12f,9f,p);line(12f,10f,12f,17f);c.drawCircle(12f,7f,.6f,p)}
 else->{val path=Path().apply{moveTo(5f,2f);lineTo(14f,2f);lineTo(20f,8f);lineTo(20f,22f);lineTo(5f,22f);close();moveTo(14f,2f);lineTo(14f,8f);lineTo(20f,8f)};c.drawPath(path,p);line(8f,12f,16f,12f);line(8f,16f,16f,16f)}
 };c.restore()}
}
class ChatWallpaper:Drawable(){private val p=Paint(Paint.ANTI_ALIAS_FLAG);override fun draw(c:Canvas){c.drawColor(Color.rgb(239,234,226));p.color=Color.argb(15,90,110,95);p.style=Paint.Style.STROKE;p.strokeWidth=2f;for(y in 0..bounds.height() step 110)for(x in 0..bounds.width() step 100){c.drawCircle(x+20f,y+30f,11f,p);c.drawLine(x+55f,y+65f,x+72f,y+80f,p);c.drawRoundRect(x+45f,y+12f,x+68f,y+30f,5f,5f,p)}};override fun setAlpha(a:Int){};override fun setColorFilter(f:ColorFilter?){};override fun getOpacity()=PixelFormat.OPAQUE}

package com.whatsgramy.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class Connection(private val context: Context) {
    val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    val url: String get() = prefs.getString("url", "") ?: ""
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("whatsgramy-token", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("whatsgramy-token", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun token(): String {
        val encoded = prefs.getString("token", null) ?: return ""
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        return Cipher.getInstance("AES/GCM/NoPadding").run { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0,12))); String(doFinal(bytes.copyOfRange(12,bytes.size)), Charsets.UTF_8) }
    }
    fun save(endpoint: String, token: String) {
        val u = endpoint.trim().trimEnd('/').toHttpUrl()
        require(u.username.isEmpty() && u.password.isEmpty() && u.query == null && u.fragment == null && u.encodedPath == "/") { "Use the backend root URL without a path or login details" }
        require(u.scheme == "https" || u.host in setOf("localhost","127.0.0.1","10.0.2.2")) { "Use HTTPS for your private backend" }
        require(token.matches(Regex("[a-fA-F0-9]{64}"))) { "Enter the 64-character API token from your backend .env" }
        val c=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE,key()) }
        prefs.edit().putString("url",u.toString().trimEnd('/')).putString("token", Base64.encodeToString(c.iv+c.doFinal(token.toByteArray()),Base64.NO_WRAP)).commit()
    }
    var autoDownload: Boolean
        get()=prefs.getBoolean("autoDownload",true)
        set(v){prefs.edit().putBoolean("autoDownload",v).apply()}
    var wifiOnly: Boolean
        get()=prefs.getBoolean("wifiOnly",true)
        set(v){prefs.edit().putBoolean("wifiOnly",v).apply()}
    var cleanup: Boolean
        get()=prefs.getBoolean("cleanup",true)
        set(v){prefs.edit().putBoolean("cleanup",v).apply()}
}
class Api(context: Context) {
    private val cfg=Connection(context)
    val client=OkHttpClient.Builder().connectTimeout(20,TimeUnit.SECONDS).readTimeout(120,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    private val metadataClient = client.newBuilder()
        .readTimeout(12, TimeUnit.SECONDS).connectTimeout(3, TimeUnit.SECONDS).build()
    private val checkpointClient = metadataClient.newBuilder().readTimeout(180, TimeUnit.SECONDS).build()
    fun request(path: String, query: Map<String,String> = emptyMap()): Request.Builder {
        require(cfg.url.isNotBlank()) { "Connect your private backend in Settings first" }
        val url=(cfg.url+path).toHttpUrl().newBuilder().apply { query.forEach { (k,v)->addQueryParameter(k,v) } }.build()
        return Request.Builder().url(url).header("Authorization","Bearer ${cfg.token()}")
    }
    fun json(path: String, method: String="GET", body: JSONObject?=null, query: Map<String,String> = emptyMap()): JSONObject {
        val builder=request(path,query)
        if(method!="GET")builder.method(method,(body?:JSONObject()).toString().toRequestBody("application/json".toMediaType()))
        return (if (path == "/api/index/backup") checkpointClient else metadataClient).newCall(builder.build()).execute().use { response->
            val text=response.body?.string()?:"{}"
            if(!response.isSuccessful)throw IllegalStateException(runCatching { JSONObject(text).optString("error","Request failed (${response.code})") }.getOrDefault("Request failed (${response.code})"))
            JSONObject(text)
        }
    }
}

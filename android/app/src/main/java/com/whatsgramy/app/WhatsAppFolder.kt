package com.whatsgramy.app

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.security.MessageDigest

class WhatsAppFolder(private val context: Context) {
    private val resolver = context.contentResolver
    private val prefs = context.getSharedPreferences("whatsapp-folder", Context.MODE_PRIVATE)

    var tree: Uri?
        get() = prefs.getString("tree", null)?.let(Uri::parse)
        set(value) { prefs.edit().putString("tree", value?.toString()).apply() }

    fun scan(api: Api, stopped: () -> Boolean = { false }): Int {
        val root = tree ?: return 0
        val result = api.json("/api/folder/candidates").getJSONArray("items")
        val candidates = (0 until result.length()).map { result.getJSONObject(it) }
        if (candidates.isEmpty()) return 0
        val sizes = candidates.groupBy { it.getLong("size") }
        val remaining = candidates.mapTo(mutableSetOf()) { it.getString("id") }
        val folders = ArrayDeque<String>()
        val visited = mutableSetOf<String>()
        folders.add(DocumentsContract.getTreeDocumentId(root))
        val columns = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        )
        var staged = 0
        while (folders.isNotEmpty() && remaining.isNotEmpty() && !stopped()) {
            val folder = folders.removeFirst()
            if (!visited.add(folder)) continue
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(root, folder)
            resolver.query(children, columns, null, null, null)?.use { cursor ->
                while (cursor.moveToNext() && remaining.isNotEmpty() && !stopped()) {
                    val id = cursor.getString(0)
                    val mime = cursor.getString(1)
                    if (cursor.getString(3).orEmpty().startsWith(".")) continue
                    if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                        folders.add(id)
                        continue
                    }
                    val size = cursor.getLong(2)
                    val possible = sizes[size]?.filter { it.getString("id") in remaining }.orEmpty()
                    if (possible.isEmpty()) continue
                    val uri = DocumentsContract.buildDocumentUriUsingTree(root, id)
                    val hash = try {
                        digest(uri, stopped)
                    } catch (_: java.io.FileNotFoundException) {
                        continue
                    }
                    for (candidate in possible.filter { it.getString("sha") == hash }) {
                        if (stopped()) return staged
                        val mediaId = candidate.getString("id")
                        val body = object : RequestBody() {
                            override fun contentType() = "application/octet-stream".toMediaType()
                            override fun contentLength() = size
                            override fun writeTo(sink: BufferedSink) {
                                val stream = resolver.openInputStream(uri) ?: error("WhatsApp file is unavailable")
                                stream.source().use { sink.writeAll(it) }
                            }
                        }
                        val request = api.request("/api/media/$mediaId/folder-source").put(body).build()
                        api.client.newCall(request).execute().use { response ->
                            check(response.isSuccessful) { "Could not stage the matching file (${response.code})" }
                            if (org.json.JSONObject(response.body?.string().orEmpty()).optBoolean("staged")) staged++
                        }
                        remaining.remove(mediaId)
                    }
                }
            }
        }
        return staged
    }

    private fun digest(uri: Uri, stopped: () -> Boolean): String? {
        val hash = MessageDigest.getInstance("SHA-256")
        resolver.openInputStream(uri)?.use { stream ->
            val buffer = ByteArray(128 * 1024)
            while (!stopped()) {
                val count = stream.read(buffer)
                if (count < 0) return hash.digest().joinToString("") { "%02x".format(it) }
                hash.update(buffer, 0, count)
            }
        }
        return null
    }
}

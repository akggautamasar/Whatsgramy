# Whatsgramy

A personal, read-only WhatsApp linked-device attachment archive with Telegram-backed recovery. Native Android APK + a private Node.js service. It is independent of WhatsApp and Telegram.

**Current status:** initial implementation. Automated lifecycle tests use an isolated fake Telegram store; the Android build pipeline also installs and launches the APK on an emulator. Live WhatsApp pairing, Telegram authorization and real attachment capture require your accounts and a deployed backend. No account is pre-connected; no public backend is provided.

## What it does

1. Link the private backend from WhatsApp **Linked devices**, using QR or pairing code.
2. Capture available ordinary incoming image, video, audio, document and sticker attachments. Keep their chat/message mapping in SQLite.
3. Download to the backend's own `data/media` folder, never the original WhatsApp download location.
4. Upload as Telegram documents, then download the Telegram copy and compare SHA-256 hashes.
5. Back up the recovery index to Telegram, encrypted with your `INDEX_KEY`.
6. The APK periodically downloads verified attachments into **its own** `Android/data/com.whatsgramy.app/files/Whatsgramy/Media` folder. Android may restrict file-manager access to this app-private folder; manage it inside Whatsgramy.
7. After 15 days, remove eligible local copies only. Pin files to keep them. Manual phone-copy deletion leaves the chat and cloud mapping intact.
8. Tap an archived attachment in Whatsgramy. If its local copy is missing, retrieve it through the private backend from Telegram, verify its hash and open it in the app. Redownloading restarts its local retention period.

Official WhatsApp's missing-attachment behavior is unchanged. This app supplies the fallback in its own read-only conversation interface. Sending messages, calls, statuses and editing chats are not implemented.

## Settings

The APK has switches for master archiving, WhatsApp capture, Telegram uploads, cloud retrieval, automatic cleanup, individual media types, phone auto-downloads, Wi-Fi-only automatic phone downloads and phone cleanup. Retention is editable from 1–365 days, default 15. Master off pauses new backend transfers and automatic cleanup; existing cloud files remain available for manual opening if cloud retrieval is enabled. An already-running transfer may finish before pause takes effect.

The backend runs on a server, so the Wi-Fi switch concerns **phone auto-downloads**, not server traffic. Manual attachment opening uses the phone's active connection. Android WorkManager schedules at a minimum 15-minute interval; battery restrictions, Doze, free space and connection availability affect when downloads actually run. Manually deleted/expired files are not automatically redownloaded by periodic sync; tapping them retrieves them again.

## Backend setup (Node 24)

Use a private always-on VM. An Oracle VM can host it once provisioned. Do not expose port 8787 directly to the internet; the default listener is loopback and the Android app expects HTTPS.

```bash
git clone https://github.com/akggautamasar/Whatsgramy.git
cd Whatsgramy/backend
cp .env.example .env
openssl rand -hex 32  # API_TOKEN
openssl rand -hex 32  # INDEX_KEY — different from API_TOKEN
```

Edit `.env` with the two generated values and your Telegram `api_id` / `api_hash` from https://my.telegram.org. Keep the file private. The default Telegram destination is **your Saved Messages** (`me`). A dedicated private archive channel username may be used instead; keep that destination unchanged while using an existing index.

```bash
npm ci --ignore-scripts
npm run telegram:login
npm start
```

Telegram login runs in your terminal. Its 2FA prompt is visible to anyone watching that terminal; do not screen-share during login. The session is saved in `data/telegram.session`, not printed. Restart the service after authorization. Treat `.env`, `INDEX_KEY`, the Telegram session and `data/whatsapp-session` as credentials. They never belong in git or an APK.

Put the service behind an HTTPS reverse proxy such as Caddy:

```caddyfile
archive.your-domain.example {
    reverse_proxy 127.0.0.1:8787
}
```

This requires a hostname that you control and DNS pointing to the VM. Open only the HTTPS port needed by your reverse proxy. For a private-network deployment use a trusted TLS certificate that the phone accepts. Do not disable TLS checks in the app.

In the APK, save that HTTPS root URL and the API_TOKEN. Check **Telegram: connected**. Request a WhatsApp pairing code using your full number with country code, then enter it in official WhatsApp → Linked devices → Link a device → Link with phone number. The QR alternative requires displaying it on another screen. Refresh Settings to see connection status. Initial chat history can take time and is not guaranteed to contain all older media.

For Docker:

```bash
mkdir -p data
# Match the container's node user; set private permissions.
sudo chown -R 1000:1000 data
chmod 700 data
docker compose build
docker compose run --rm whatsgramy node src/telegram-login.js
docker compose up -d
```

`compose.yml` binds only 127.0.0.1. Use the HTTPS proxy above. Back up the complete `data` folder and `.env` securely, especially INDEX_KEY. Do not run two backend instances against the same WhatsApp session or SQLite directory.

## Recovery and deletion rules

- Upload success alone is insufficient: complete remote SHA-256 verification is required.
- Failed transfers keep their local copies. Retries back off; after 20 failures the UI offers explicit Retry.
- Cleanup never deletes Telegram messages. There is no remote-delete API in this version.
- The encrypted recovery index must be backed up before a backend local copy can be deleted.
- Manual **Delete this phone's copy** affects only the APK's cache. The backend uses its own retention timer. **Keep local copy** in the APK pins that phone copy only.
- To recover a lost backend index: restore `.env`/INDEX_KEY and authorize the same Telegram account/destination, stop the service, run `npm run index:restore`, then restart. This recovers verified attachment references and conversation metadata; pending uncaptured media cannot be reconstructed from that index.
- Telegram archive documents contain the attachment bytes without application-layer encryption. The recovery index is AES-256-GCM encrypted; the attachments themselves are ordinary Telegram cloud-chat files. The private backend can read them. Do not describe this as end-to-end encryption of the archive.

## Limits

- Baileys is an unofficial, reverse-engineered linked-device integration. Compatibility, linking and account availability are not guaranteed. Test with an account you are comfortable using for an experimental client.
- Only media actually delivered and downloadable while capture works can be archived. There is no promise to recover attachments already expired or unavailable before capture.
- View-once/disappearing wrappers and status broadcasts are excluded. This app does not bypass their restrictions.
- Current backend caps attachments at 2,000,000,000 bytes; larger files are retained/reported, not split. Telegram Premium splitting/4-GB handling is not implemented.
- Native previews cover common images, video/audio codecs supported by the phone, PDFs and text. Other files remain archived/downloadable but do not have built-in format renderers yet.
- The backend uses 15-day local retention too. Provision enough temporary server space for your incoming media rate and verification downloads. A failed backup can require retaining files beyond 15 days.
- Archive metadata lives on the server; the APK currently fetches chats/files from it and needs backend access to browse or retrieve. An offline chat database is not implemented.
- The APK is an initial debug-signed preview. Set up stable release signing before relying on in-place updates across builds.

## Validation

```bash
cd backend
npm ci --ignore-scripts
npm run check
npm test
```

Tests cover verified upload → recovery index → local deletion → remote fallback, corrupt remote retention, 15-day retention and pinning, Settings gates, index restoration, API authentication/validation, excluded ephemeral media, and encrypted-index tampering. They do not substitute for live account testing.

GitHub Actions builds the APK, verifies signing/alignment, installs/starts it on Android 15, runs the backend tests and then publishes a preview release with SHA-256 checksum. No native TDLib compilation is required; the backend uses GramJS with a Telegram user session.

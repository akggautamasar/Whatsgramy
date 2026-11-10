# Whatsgramy

A personal, read-only WhatsApp attachment archive with Telegram recovery. The Android APK runs the linked-device engine, database and Telegram client **on the phone**, without a hosted backend.

## Phone setup (0.3.0)

1. Install the APK and open Settings. The foreground archive notification indicates that the phone engine is running.
2. Enter your own Telegram API ID and hash from https://my.telegram.org and your phone number. Complete the Telegram code and optional two-step password prompts. Passwords and codes are not saved.
3. Connect WhatsApp, then request a pairing code. In official WhatsApp, use **Linked devices → Link a device → Link with phone number** and enter the code. Refresh Settings to check connection status.
4. Enable the file types and archive controls you want. Receive a normal attachment, then check its upload and verification status in Files or Upload history.
5. Open files from Whatsgramy. Long-press an attachment to keep a local copy or delete verified local copies. Default retention is 15 days. Telegram Saved Messages stores files and the recovery index.

The engine uses a loopback-only authenticated interface inside the APK; you do not configure a URL, API token or deployed service. Account sessions, credentials, SQLite and captured files are kept in Android app-private storage. Uninstalling removes phone data; reconnecting the same Telegram account restores backed-up metadata and file references.

Android limits data-sync foreground services (including a six-hour daily budget on Android 15+). The engine stops when its budget expires; use Start / resume from Settings when allowed. WorkManager handles periodic phone-cache work while the engine is available. This is not a guarantee of uninterrupted capture: files must still be available from WhatsApp when the linked device receives them. Historical media, disappearing messages and view-once content cannot be promised; view-once and disappearing messages are excluded.

**Validation:** archive lifecycle tests use a fake Telegram store. CI builds the embedded runtime and checks Android installation, Node/SQLite startup and loopback health without any hosted service. Real WhatsApp linking and Telegram authorization require your accounts and have not been validated by CI. This is an unofficial personal-use preview.

## Archive behavior (shared engine)

1. Link Whatsgramy from WhatsApp **Linked devices**, using QR or pairing code.
2. Capture available ordinary incoming image, video, audio, document and sticker attachments. Keep their chat/message mapping in SQLite.
3. Download to the engine's private `files/engine/media` folder, never the original WhatsApp download location.
4. Upload as Telegram documents, then download the Telegram copy and compare SHA-256 hashes.
5. Automatically checkpoint the recovery index to **Telegram Saved Messages**, separately from the media destination. The default account-protected JSON mode supports recovery with the same Telegram login; optional encrypted mode requires the original INDEX_KEY.
6. The APK periodically downloads verified attachments into **its own** `Android/data/com.whatsgramy.app/files/Whatsgramy/Media` folder. Android may restrict file-manager access to this app-private folder; manage it inside Whatsgramy.
7. After 15 days, remove eligible local copies only. Pin files to keep them. Manual phone-copy deletion leaves the chat and cloud mapping intact.
8. Tap an archived attachment in Whatsgramy. If its local copy is missing, retrieve it directly from Telegram, verify its hash and open it in the app. Redownloading restarts its local retention period.

Official WhatsApp's missing-attachment behavior is unchanged. This app supplies the fallback in its own read-only conversation interface. Sending messages, calls, statuses and editing chats are not implemented.

## Settings

The APK has switches for master archiving, WhatsApp capture, Telegram uploads, cloud retrieval, automatic cleanup, individual media types, phone auto-downloads, Wi-Fi-only automatic phone downloads and phone cleanup, and automatic recovery-metadata checkpoints. Retention is editable from 1–365 days, default 15. Master off pauses new backend transfers and automatic cleanup; existing cloud files remain available for manual opening if cloud retrieval is enabled. An already-running transfer may finish before pause takes effect.

The backend runs on a server, so the Wi-Fi switch concerns **phone auto-downloads**, not server traffic. Manual attachment opening uses the phone's active connection. Android WorkManager schedules at a minimum 15-minute interval; battery restrictions, Doze, free space and connection availability affect when downloads actually run. Manually deleted/expired files are not automatically redownloaded by periodic sync; tapping them retrieves them again.

## Optional desktop service setup (development only) (Node 24)

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

`compose.yml` binds only 127.0.0.1. Use the HTTPS proxy above. Back up the complete `data` folder and `.env` securely, especially INDEX_KEY if encrypted metadata is enabled. Do not run two backend instances against the same WhatsApp session or SQLite directory.

## Recovery and deletion rules

- Upload success alone is insufficient: complete remote SHA-256 verification is required.
- Failed transfers keep their local copies. Retries back off; after 20 failures the UI offers explicit Retry.
- Cleanup never deletes Telegram messages. There is no remote-delete API in this version.
- The encrypted recovery index must be backed up before a backend local copy can be deleted.
- Manual **Delete this phone's copy** affects only the APK's cache. The backend uses its own retention timer. **Keep local copy** in the APK pins that phone copy only.
- A fresh empty archive automatically searches Saved Messages after Telegram authorization on backend startup, validates the newest readable index and restores it. Original Telegram destinations are recorded per file, so the index is discoverable even when media is in another private chat/channel. A corrupted checkpoint falls back to an earlier readable one. Existing local archives are not replaced. Errors block new archive transfers rather than silently publishing an empty replacement. The same account must retain access to its media destinations.
- For an explicit recovery/merge, stop the service and run `npm run index:restore`. Encrypted v1 backups are still readable with the original INDEX_KEY. Pending files without a Telegram copy restore as **needs source**, not as backed up. Re-delivery of an available matching WhatsApp message can requeue them. Local paths, phone credentials, WhatsApp media decryption keys and login sessions are never reconstructed from the manifest.
- Default metadata mode (`INDEX_MODE=telegram`) stores filenames, chat labels/text, file hashes, upload dates, statuses, Telegram references, activity history and archive preferences in a JSON document in your Saved Messages. It is protected by your Telegram account, not application-layer end-to-end encryption. This enables same-login recovery without the old local recovery key. Set `INDEX_MODE=encrypted` for AES-256-GCM metadata encryption; that mode requires keeping the original INDEX_KEY. Attachments themselves remain ordinary Telegram cloud-chat documents in both modes. Login/session credentials are excluded.
- Automatic metadata backup has its own Settings switch. If disabled, uncheckpointed local files cannot be deleted until you manually back up the recovery index. Counts are rebuilt from records rather than trusting cached totals. Duplicate content can reuse a verified Telegram upload while retaining separate chat/message mappings. This only protects records in completed checkpoints; unsuccessful metadata uploads are reported and retried.

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

See [recovery manifest contract](docs/recovery-manifest.md) for the phone-only data model and recovery guarantees.

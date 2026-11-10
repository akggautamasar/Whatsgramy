# Legacy desktop service

These commands are for development and the older 0.2.0 client. The current 0.3.0 APK runs its own phone engine and does not have a remote server connection screen.

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


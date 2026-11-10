# Recovery manifest v2: phone-only contract

The intended phone-only Whatsgramy engine must use this contract. **The current APK is still a client of the private backend; the on-device WhatsApp/Telegram engine has not shipped.** These fields are independent of the process that performs transfers and can be moved to an Android database and Telegram client without a public service.

## What is remembered

- Attachment ID = SHA-256 of WhatsApp account ID, chat ID and message ID, preventing duplicate message imports.
- Name, MIME type/category, byte size, content SHA-256, source chat/message and received-message timestamp.
- Telegram message ID and a serialized destination peer, including channel/user access hash where needed for resolving the same destination after recovery. These references still require authorization to the original account/destination; they are not public download links.
- Discovered/uploaded/verified dates where recorded, upload status, retry count and failure description.
- One record per WhatsApp attachment even when multiple records share an identical verified Telegram object.
- Chat names, sender labels, message text/captions and message-to-file relationships.
- Timestamped upload, verification, failure, recovery, pinning and local-removal activity.
- Archive preferences and the configured retention period. Phone-local credentials, absolute file paths, session cookies, WhatsApp transport/decryption keys and partial-download files are excluded.
- Summary counts/bytes per file type and state, and unique verified content counts. Readers recompute totals from records.

## Automatic checkpoints

The marker is `#whatsgramy-index-v2`; the document payload contains `marker: WHATSGRAMY_MANIFEST_V2`, `version: 2`, `createdAt`, a revision number, Telegram account ID, settings, summary, chats, messages, media and events. The index always goes to **Saved Messages**, even if attachment documents use another destination. Each attachment stores its own destination reference.

A dirty revision triggers a checkpoint after an archive batch and after settings/history changes. A successful checkpoint records its date, revision and Telegram message ID. Upload/metadata errors stay visible and are retried. Automatic metadata checkpointing can be disabled independently; manual backup remains available. A locally deleted file's removal event is included in the next successful checkpoint.

The current archive engine checkpoints batches; it does not promise that a process killed before its next checkpoint has saved every latest event. No failed/pending item is reported as remotely protected. Credentials and original unuploaded bytes cannot be recovered from metadata alone.

## Restore order

1. Authorize the same Telegram account. Check any locally recorded account identity before touching records.
2. If a usable local archive exists, keep it. A fresh archive checks Saved Messages automatically before new capture starts.
3. Search recent marker documents; validate versions, account identity, record types and IDs. If a checkpoint is corrupt/unreadable, try an earlier one. Legacy encrypted v1 documents can be read with the original key.
4. Merge verified references and known history in a transaction. Do not import old absolute file paths or declare that bytes exist on the new phone.
5. Restore preferences on a fresh archive; preserve preferences when explicitly merging into an existing one.
6. Pending files without remotely protected bytes become `needs_source`. If an available WhatsApp message later arrives with the same ID, it can be queued again.
7. Recompute counts, retain the original upload dates and show cloud-only records. Do not automatically upload or download every verified record during index recovery.
8. Opening an attachment retrieves it from its stored Telegram destination and verifies SHA-256. Lost access or removed remote content is an error, not a successful recovery.

## Login-only vs encrypted recovery

`INDEX_MODE=telegram` is the default: a JSON index in Saved Messages, protected by the Telegram account. New installation recovery does not need the old INDEX_KEY. This exposes archive metadata to the same cloud-chat trust model as the stored documents; it is not application-layer E2EE.

`INDEX_MODE=encrypted` encrypts metadata with AES-256-GCM. Telegram login alone cannot decrypt that mode; the original recovery key is essential. Existing encrypted v1 archives are not silently converted without successfully reading them first. If no readable checkpoint exists, capture/checkpoint publication is blocked and the recovery error is displayed.

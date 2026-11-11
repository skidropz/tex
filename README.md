# Tex

A self-hosted chat application for shared PHP hosting. Plain PHP 8 on top of MySQL (or SQLite for
local work), no Composer, no build step, no Node. Upload the files, run the installer, done.

The interface is a Messenger-style web client with themes, 122 animated Yahoo! Messenger emoticons,
per-message replies and reactions, presence, and Romanian/English strings. Messages can be
end-to-end encrypted, so the server stores ciphertext it cannot read. Large files skip the server
entirely over WebRTC.

There is also an Android client that runs this same front end inside a WebView; it lives in a
separate repository and is not part of this one.

---

## Contents

- [Screens](#screens)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Local development](#local-development)
- [Architecture](#architecture)
- [HTTP API](#http-api)
- [Data model](#data-model)
- [Security](#security)
- [Push notifications](#push-notifications)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Screens

<p align="center">
  <img src="docs/screenshots/web-02-lista-mobil.png" width="24%" alt="Conversation list">
  <img src="docs/screenshots/web-03-conversatie-mobil.png" width="24%" alt="Conversation">
  <img src="docs/screenshots/web-05-setari.png" width="24%" alt="Settings">
  <img src="docs/screenshots/web-04-desktop.png" width="24%" alt="Desktop layout">
</p>

## Features

**Messaging.** 1:1 and group conversations, long-poll delivery, typing indicators, sent / delivered
/ read receipts, replies, emoji reactions, message editing, pinned messages, in-conversation search,
lightbox previews for images and video.

**Files.** Chunked uploads with resume, original quality (no re-encoding), served back through
`api/file.php` with Range support so video seeks work. Anything large can instead go peer-to-peer
over a WebRTC data channel, in which case the bytes never traverse the server.

**Calls.** 1:1 audio/video over WebRTC, signalled through the same long-poll. SDP and ICE are
sealed inside the E2E envelope when the conversation is encrypted.

**Encryption.** ECDH P-256 key agreement, HKDF-SHA256, AES-256-GCM. The private key is stored on the
server only as ciphertext wrapped with a password-derived key (PBKDF2-SHA256, 310,000 iterations by
default). Group keys are wrapped per member.

**Presence.** Available / Busy / Away / Invisible, delivered as events. Going invisible actually
hides the connection, including on devices that are still sending heartbeats.

**Appearance.** Several palettes and wallpapers, light and dark, Liquid Glass and Yahoo! Messenger
classic skins, reduced-motion handling, per-user zoom.

## Requirements

| | |
|---|---|
| PHP | 8.0 or newer (8.1–8.3 recommended) |
| Extensions | `pdo_mysql`, `mbstring`, `fileinfo` (`pdo_sqlite` and `exif` optional) |
| Database | MySQL 5.7+ / MariaDB 10.3+, or SQLite for local demos |
| Web server | Apache with `.htaccess` (any standard cPanel account) |
| HTTPS | Recommended. Required for disk-streamed P2P downloads and service workers |

No Composer, no npm, no build step. The front end is served as-is.

## Installation

### 1. Upload the files

Copy the application into `public_html` or a subfolder (for example `public_html/chat`). Two dotfiles
matter and are easy to miss: `.htaccess` (HTTPS redirect, security headers, blocked paths) and
`.user.ini`. Enable **Settings → Show Hidden Files** in cPanel's File Manager to see them.

### 2. Create the database

cPanel → **MySQL® Database Wizard**. Create a database, create a user with `ALL PRIVILEGES` on it,
and note the three values. On cPanel they are prefixed with your account name
(`account_chat`, `account_chatuser`).

### 3. Run the installer

Open `https://your-domain/chat/install.php`. It checks the PHP version, the extensions and write
access to `uploads/`, `data/` and `config/`. Enter the database details and the application name;
the installer creates the tables and writes `config/config.php`.

Delete `install.php` afterwards. It locks itself via `data/installed.lock`, but removing it is
cleaner.

### 4. HTTPS

Issue a certificate from cPanel (**SSL/TLS Status → AutoSSL**, or Let's Encrypt) and leave
`force_https` and `hsts` enabled in the config. The redirect in `.htaccess` excludes
`/.well-known/` so certificate validation keeps working, and it respects `X-Forwarded-Proto` behind
Cloudflare or another proxy.

### 5. First account

Register through the login page. No account is an administrator by default; `admin.php` checks
`account_flags.is_admin` and returns 403 otherwise. To enable the panel for yourself, set that
column to 1 for your user id:

```sql
INSERT INTO account_flags (user_id, is_admin, updated_at) VALUES (1, 1, UNIX_TIMESTAMP())
  ON DUPLICATE KEY UPDATE is_admin = 1, updated_at = UNIX_TIMESTAMP();
```

## Configuration

`config/config.example.php` documents every key. Copy it to `config/config.php`, or let the
installer write it. The file is denied by `.htaccess` and must never be committed or zipped.

```php
return [
    'db' => [
        'driver' => 'mysql',        // 'mysql' or 'sqlite'
        'host'   => 'localhost',
        'port'   => 3306,
        'name'   => 'account_chat',
        'user'   => 'account_chatuser',
        'pass'   => '...',
        'charset'=> 'utf8mb4',
    ],
    'app' => [
        'name'             => 'Tex',
        'poll_timeout'     => 20,          // long-poll window, seconds
        'max_upload_bytes' => 0,           // 0 = no limit beyond disk space
        'chunk_bytes'      => 2*1024*1024, // must stay below post_max_size
        'secure_cookies'   => null,        // null = auto
        'force_https'      => true,
        'hsts'             => true,
    ],
    'fcm' => [
        'enabled'         => true,
        'service_account' => __DIR__ . '/fcm-service-account.json',
        'presence'        => true,
        'presence_throttle' => 60,
    ],
    'ice_servers' => [
        ['urls' => ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']],
        // add a TURN server for restrictive or symmetric-NAT networks
    ],
];
```

Notes that have bitten people before:

- `chunk_bytes` is the upload chunk size. It must be smaller than PHP's `post_max_size` and
  `upload_max_filesize`, otherwise large uploads fail with an empty response.
- Without a TURN server, WebRTC connections fail on symmetric NAT (common on mobile networks). The
  client reports the failure and offers the server upload path instead of hanging.
- If `config/config.php` is missing entirely, the application falls back to SQLite in
  `data/messenger.sqlite`. That is for demos only.
- `config/` holds the Firebase service account and the FCM token cache. It must stay non-public.

## Local development

The demo mode runs a single PHP process against SQLite and never touches the cPanel configuration:

```bash
./start-demo.sh             # http://localhost:8080
PORT=9000 ./start-demo.sh   # different port
```

The script needs `php` with `pdo_sqlite` and `mbstring`, creates `data/local-demo/` and
`uploads/local-demo/`, and serves through `router.php`. Delete those two folders to start over.
Register two accounts in two browsers (or a private window) to see conversations, presence and the
themes in action.

On macOS: `brew install php`. On Debian/Ubuntu: `apt install php-cli php-sqlite3 php-mbstring`.

## Architecture

```
browser ──HTTPS──► Apache + .htaccess ──► index.php / login.php / admin.php
                        │
                        ├── api/*.php        JSON endpoints (session + CSRF)
                        └── lib/*.php        shared code, no routing of its own
                                 │
                                 ▼
                          MySQL / MariaDB
                          (SQLite in demo)
```

There is no framework and no router beyond `.htaccess`. Each request enters one file under `api/`,
which includes `lib/bootstrap.php` and returns JSON. `lib/bootstrap.php` opens the database, creates
or migrates the schema on first use, starts the session, and provides the helpers every endpoint
uses: `require_auth()`, `require_member()`, `input()`, `json_out()`, `push_event()`,
`create_message()`.

**Realtime is long-polling.** `api/poll.php` holds the connection open for `poll_timeout` seconds and
returns whatever events appeared for the current user. This works on shared hosting where WebSockets
and background workers are unavailable. Messages, receipts, typing, presence and WebRTC signals all
ride that one channel, which is why presence and call invitations survive a page reload.

**Open tabs cooperate.** Interaction timestamps are reconciled across tabs and devices, so closing
one tab is not a logout and an idle browser does not overwrite an active one.

**The front end** in `assets/` is plain ES modules-free JavaScript: `app.js` for the chat, `e2e.js`
for crypto, `p2p.js` for transfers, `videocall.js` for calls, plus per-feature files. There is no
bundler; files load in order from `index.php`.

## HTTP API

All endpoints return JSON. Writes require `POST` plus the `X-CSRF-Token` header; reads use the
session cookie. Errors come back as `{"ok":false,"error":"..."}` with an appropriate status code.

| Endpoint | Purpose |
|---|---|
| `api/auth.php` | login, register, logout, `me`, settings, password change |
| `api/conversations.php` | list, open, create group, rename, add/leave members, delete, destroy |
| `api/messages.php` | history (`GET`), send, edit, delete, react, read receipts |
| `api/poll.php` | long-poll event stream; `init=1` returns a cursor without waiting |
| `api/contacts.php` | contact list, add, remove, aliases, ignore |
| `api/users.php` | global user search for the Add dialog |
| `api/upload.php` | chunked upload: `init` → `chunk` (repeated) → `finish`, with resume |
| `api/file.php` | download for conversation members, Range support, correct MIME |
| `api/keys.php` | E2E key registry: `mine`, `pub`, `setup`, `verify`, `conv`, `wrap` |
| `api/signal.php` | WebRTC signalling: `offer`, `signal`, `status` |
| `api/conversation-tools.php` | pins, search, per-conversation tooling |
| `api/recovery.php` | account recovery with a security question, throttled |
| `api/fcm_register.php` | register or remove a device push token |
| `api/avatar.php` | avatar upload and serving |
| `api/admin.php` | administrative actions, admin accounts only |

## Data model

MariaDB/MySQL schema in `sql/schema.sql`, SQLite equivalent in `sql/schema.sqlite.sql`.

| Table | Holds |
|---|---|
| `users` | accounts, display name, status, settings JSON, password hash |
| `user_keys` | public JWK plus the password-wrapped private key per user |
| `conversation_keys` | group keys wrapped for each member, per key version |
| `conversations`, `conversation_members` | threads, membership, per-member read cursor |
| `messages` | text, attachments, replies, `meta` JSON (E2E envelope, P2P offer, captions) |
| `attachments` | uploaded file records with completion state |
| `reactions`, `message_edits`, `conversation_pins` | reactions, edit history, pins |
| `events` | the long-poll queue, one row per user per event |
| `contacts`, `contact_preferences` | contact list, aliases, ignore/restrict state |
| `user_presence` | last activity and heartbeat |
| `fcm_tokens` | device push tokens per platform |
| `user_security`, `recovery_*`, `auth_devices` | recovery flows, device credentials, throttles |
| `admin_audit`, `account_flags`, `account_display_labels` | admin surface |

Encrypted messages keep the ciphertext in `messages.body` (base64) with `meta.e2e` describing the
IV, key version and tag context. The server never stores a plaintext body for those rows.

## Security

What is implemented:

- **Prepared statements** everywhere; no string-built SQL with user input.
- **CSRF tokens** on every mutating request, rotated per session.
- **Password hashing** with `password_hash()` (bcrypt). Minimum 12 characters, capped at 72 bytes.
- **Session hardening**: HttpOnly, SameSite=Lax, `secure` when HTTPS is on,
  `session_write_close()` before long operations so polls do not block writes.
- **Device credentials** as an alternative to keeping passwords alive: `TEXDEVICE` holds a
  selector/validator pair, stored only as hashes, rotating daily with a 120-second overlap for
  in-flight requests, revoked on password change.
- **E2E encryption** so message contents are unreadable to the server, its backups, and anyone who
  gains database access.
- **Access control** on every conversation-scoped endpoint (`require_member`), including file
  download.
- **Rate limiting and throttling** on login, registration and recovery, keyed by account and IP.
- **Enumeration resistance** in recovery: generic responses, no plaintext answers stored or logged,
  no answers in URLs.
- **Headers** in `.htaccess`: `nosniff`, `Referrer-Policy: same-origin`, a `Permissions-Policy` that
  allows camera and microphone for this origin only, HSTS on HTTPS.
- **Denied paths**: `*.md`, `*.sql`, `*.sqlite`, `*.lock`, `*.part`, `*.cache.php`, service account
  JSONs, and `config/` as a whole.

What is not:

- No certificate pinning; transport trust is the system trust store.
- E2E protects message contents, not metadata. The server still sees who talks to whom and when.
- Attachments in encrypted conversations are encrypted client-side, but filenames and sizes are
  visible unless the client seals them too.

## Push notifications

Optional, and off unless you supply a Firebase service account file.

1. Create a Firebase project and a service account, download the JSON.
2. Place it at `config/fcm-service-account.json` (blocked from the web by `.htaccess`).
3. Set `fcm.enabled` to `true`.

Tokens are registered by clients through `api/fcm_register.php`. Payloads are data-only, so the
client decides what to show. That is what lets an encrypted conversation display the real message
text instead of "New message".

One detail worth knowing if you modify `lib/fcm.php`: `fcm_queue()` registers a shutdown hook that
flushes the batch after the response has been sent, and `poll.php` additionally flushes early because
it can sit in a long-poll for twenty seconds. If you remove either path, pushes end up delayed by
seconds or not sent at all.

## Upgrading

1. Back up `config/config.php`, `data/` and the database.
2. Replace the application files, keeping `config/config.php`, `uploads/` and `data/`.
3. Load the site once: schema migrations run automatically on the first request.
4. If a version ships a SQL file in `sql/` (for example `upgrade-2.1.17.sql`), it is optional; the
   automatic migration covers it on most hosts.

`CHANGELOG.md` lists what changed in each version.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Blank page or 500 on every request | `config/config.php` missing or unreadable, or a PHP extension missing |
| Login works, then everything is 401 | cookies blocked; check `secure_cookies` against whether the site is actually HTTPS |
| Messages send but never arrive | `poll_timeout` longer than the host's PHP `max_execution_time`; lower it to 20 |
| Large uploads fail with an empty response | `chunk_bytes` above `post_max_size` / `upload_max_filesize` |
| P2P or calls never connect | no TURN server, or a firewall blocking UDP; check `ice_servers` |
| E2E prompt keeps appearing | the password is required to unwrap the private key; there is no recovery without it |
| Push does nothing | `config/fcm-service-account.json` missing, or a stale token; re-register the device |
| Redirect loop after enabling HTTPS | a proxy terminating TLS; the `X-Forwarded-Proto` condition covers it, verify it is passed |

## License

No license file is included. Contact the author before redistributing.

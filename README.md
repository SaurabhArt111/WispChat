# Wisp Chat

Wisp Chat is a real-time, end-to-end-encrypted messenger with voice/video calls, WhatsApp-style Status, an Instagram-style Explore feed, groups, broadcast lists and a PWA you can install on desktop or phone.

- **Client:** React 18 + Vite, React Router, Socket.IO client, `vite-plugin-pwa` (Workbox)
- **Server:** Node.js (ESM) + Express, Socket.IO, MongoDB (Mongoose), Multer for uploads
- **Calls:** WebRTC (peer-to-peer, DTLS-SRTP encrypted) signalled over Socket.IO, optional TURN relay

---

## Features

### Messaging
- 1-to-1 chats and groups (name, photo, description, admins, "only admins can message")
- Text, images, video, audio/voice, GIFs, stickers and documents (send as *document* to skip compression)
- Pre-send media composer with crop, rotate and draw tools; client-side compression (ffmpeg.wasm for video/GIF)
- Optimistic sending with per-attachment progress, retry on failure
- Reply, forward (re-encrypted per destination), edit, delete for me / for everyone (with 3 s **Undo**)
- Emoji reactions, typing indicators, delivered/read receipts, online presence and last seen
- Virtualised message list, infinite scroll back through history, jump-to-replied-message
- Search chats (`Ctrl/⌘ + F` or `/`), paste files/images straight into the composer, drag & drop
- Per-chat mute, pin, archive, folders, clear history, delete chat; per-chat wallpapers
- System notifications for messages and incoming calls

### End-to-end encryption
- Each account generates an ECDH key pair in the browser at sign-up. The private key is wrapped with the password (PBKDF2 → AES-GCM) and stored on the server as opaque ciphertext, so it can be unlocked on any device with the password and never exists in plaintext on the server.
- Every message (and each attachment's bytes) gets a fresh AES-GCM key, wrapped separately for each participant. The server only stores ciphertext.
- Calls are always encrypted by WebRTC; a **safety code** derived from both DTLS fingerprints can be compared out loud to detect interception.

### Voice & video calls
- 1-to-1 audio and video, ringtone/ringback, 45 s ring-out, missed/declined/completed call log (also shown in the Calls tab)
- Mute, camera off, front/back camera switch, call timer, live "muted / camera off / lost connection" indicators for the other side
- Auto-recovery: ICE restart on network changes, 15 s server grace period if a socket drops mid-call, wake lock to keep the screen on
- Ringing devices are silenced when you answer or decline on another tab/device
- STUN out of the box, **TURN relay** configurable (see [Calls & TURN](#calls--turn))

### Status (stories)
- Text or photo/video statuses that expire after 24 h, max 5 active per person
- Viewer list with view counts, emoji reactions
- Privacy: my contacts / my contacts except… / only share with…

### Explore & posts
- **Explore** is an endless, freshly shuffled grid of posts from people you know **and** people you don't. Tabs: *For you* (mix), *Friends*, *Discover* (people outside your contacts). Friends' posts carry a "Friend" tag. Infinite scroll never repeats a post; new posts from others appear via a "N new posts" pill.
- Search people by `@username`, name, email or user ID and open their profile
- Each person can keep up to 6 posts (photo or video + caption); edit caption/media, delete, like and comment (edit/delete own comments)
- **Post viewer** lives on the route `/post/:id`:
  - **Desktop:** opens as a modal over where you were; ← / → (or the arrow buttons) step through the next posts
  - **Mobile:** opens as a full page with a vertical snap-scroll feed — the post you opened first, then the posts that followed it, then endless suggestions from other people. Videos autoplay only when on screen; comments open in a bottom sheet; the URL follows the visible post
  - **Double-click / double-tap** to like, with a heart animation where you tapped

### Contacts & discovery
- Friend requests (send / accept / decline), contacts list, block/unblock
- "People you may know" (mutual contacts) and people whose posts you liked

### Other
- Media & storage panel with usage stats/charts and a browsable media library
- Broadcast lists, Groups panel, Archived chats
- Installable PWA (offline app shell, install prompts for Android/desktop/iOS), auto-update

---

## Real-time updates & caching (how it stays fresh)

Nothing requires a reload:

| Data | How it updates |
|------|----------------|
| Messages, edits, deletes, reactions, read receipts, typing, presence | Socket events |
| Profile name / photo / about | `user:updated` pushed to contacts and everyone sharing a chat; own other devices get `me:updated` |
| Mute / pin / archive / folder / clear / delete chat | `conversation:flags`, `conversation:cleared`, `conversation:removed` (mirrors to your other tabs/devices) |
| Status feed (new slide, views, reactions, privacy, expiry) | `status:changed` + refresh on reconnect / focus / every minute |
| Posts (new, like counts, comments, edits, deletes) | `post:new`, `post:stats`, `post:comment*`, `post:updated`, `post:deleted` broadcast to the `explore` room |
| Friend requests / contacts | `friend-request:*`, `contacts:changed` |
| Calls | `call:*` events |

Safety nets (`client/src/hooks/useLiveRefresh.js`): every live view also re-syncs when the socket reconnects, when the tab/app returns to the foreground, when the network comes back, and on a slow poll. Opening a chat always revalidates its messages against the server (the cached copy is only shown first for speed).

**Caching rules**
- Server sends `Cache-Control: no-store` on every `/api/*` response and disables ETags.
- The service worker uses **NetworkOnly** for `/api` and `/socket.io` (previously a NetworkFirst rule could serve day-old API data).
- Uploaded files have unique names, so `/uploads` is served immutable and cached by the SW (with range-request support for video/audio seeking).
- The PWA uses `autoUpdate` + `skipWaiting` + `clientsClaim`: a new deploy takes over on the next visit/check rather than waiting for a click. `sw.js`, `index.html` and the manifest are served no-cache (see `client/vercel.json`); hashed `/assets/*` are immutable.

---

## Project structure

```
client/                     React app (Vite)
  src/
    api/                    axios client, posts API, upload helpers, config
    context/                Auth (E2EE), Socket, Chat, Status, Call, Toast, ContextMenu
    hooks/                  useLiveRefresh, useLivePosts, useDoubleTap, usePostLike, useMediaQuery, ...
    components/
      Call/                 CallOverlay (audio/video call UI)
      Chat/                 ChatWindow, MessageList/Bubble, Composer, GroupInfo, ContactInfo
      Posts/                PostViewerPage (route), PostViewerModal (desktop), PostFeedPage (mobile), PostsGrid
      Sidebar/              Chat list, Explorer, Status, Calls, Groups, Broadcast, Media, Settings, modals
      Profile/  MediaComposer/  common/
    pages/                  ChatApp (shell + routing), AuthPage
    styles/  utils/         CSS, crypto, compression, caches
server/
  server.js                 Express + Socket.IO bootstrap, cache headers, CORS
  src/
    models/                 User, Conversation, Message, Status, Post, FriendRequest
    controllers/            auth, user, conversation, message, status, post
    routes/                 REST routes (+ /api/calls/ice)
    sockets/index.js        presence, typing, call signalling
    utils/                  jwt, realtime (emit helpers)
    middleware/             auth, upload (Multer, media folders)
```

Routes: `/` chats · `/chat/:id` · `/explore` · `/status` · `/calls` · `/groups` · `/broadcast` · `/media` · `/profile` · `/post/:id` · `/settings`.

---

## Getting started

Requirements: Node 18+, MongoDB, and HTTPS (or `localhost`) — the browser's Web Crypto and WebRTC APIs need a secure context.

```bash
# 1. server
cd server
cp .env.example .env        # set MONGO_URI, JWT_SECRET, CLIENT_ORIGIN
npm install
npm run dev                 # or: npm start   (listens on :5000)

# 2. client
cd ../client
cp .env.example .env        # VITE_BACKEND_URL=http://localhost:5000
npm install
npm run dev                 # http://localhost:5173
```

Production: `npm run build` in `client/` (deploy `dist/`, e.g. Vercel — `vercel.json` included) and run the server behind HTTPS with `NODE_ENV=production`, setting `CLIENT_ORIGIN` to your site's origin(s).

### Environment variables

Server (`server/.env`)

| Variable | Purpose |
|----------|---------|
| `PORT`, `HOST` | Listen address (default `5000`, `0.0.0.0`) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string for signing sessions |
| `CLIENT_ORIGIN` | Comma-separated allowed browser origins |
| `NODE_ENV` | `production` makes CORS strict (dev auto-allows localhost/LAN) |
| `UPLOAD_DIR` | Directory for uploaded media; point this at persistent storage in production (for Render, e.g. `/var/data/uploads` on a disk mounted at `/var/data`) |
| `TURN_URLS`, `TURN_SECRET` *or* `TURN_USERNAME` + `TURN_CREDENTIAL` | Optional TURN relay for calls |

On Render, attach a persistent disk to the server service (for example, mount it at `/var/data`) and set `UPLOAD_DIR=/var/data/uploads`. Without a persistent disk or external object storage, uploaded files on Render's filesystem disappear when the service restarts or redeploys. Previously lost files cannot be restored by changing this setting; they must be uploaded again.

Client (`client/.env`): `VITE_BACKEND_URL` — origin of the API/socket server.

### Calls & TURN

STUN alone connects most home networks. On mobile data, symmetric NATs or corporate Wi-Fi, a call can "connect" with no audio/video unless a TURN relay is available. Set either:

- **coturn** with `use-auth-secret`: `TURN_URLS=turn:host:3478?transport=udp,turns:host:5349?transport=tcp` and `TURN_SECRET=<static-auth-secret>` (short-lived credentials are generated per request), or
- a hosted provider (Metered, Twilio, Xirsys…): `TURN_URLS` + `TURN_USERNAME` + `TURN_CREDENTIAL`.

The client fetches the ICE list from `GET /api/calls/ice`.

---

## Realtime API (Socket.IO)

Every socket joins `user:<id>`, `explore`, and `conversation:<id>` for its chats. Authenticate with `auth: { token }`.

- **Chat:** `message:new|edited|deleted|reaction|read`, `typing:start|stop|update`, `presence:update`, `conversation:new|updated|flags|cleared|removed|member-left`
- **Profile/social:** `user:updated`, `me:updated`, `friend-request:new|resolved|changed`, `contacts:changed`, `status:changed`
- **Posts:** `post:new|updated|deleted|stats|comment|comment-updated|comment-deleted`
- **Calls (client → server):** `call:invite`, `call:answer`, `call:ice-candidate`, `call:signal` (renegotiation), `call:media-state`, `call:decline`, `call:end`
- **Calls (server → client):** `call:incoming|ringing|answered|ice-candidate|signal|media-state|declined|busy|unavailable|timeout|ended|handled-elsewhere|peer-unstable|peer-reconnected`

## REST API (all under `/api`, Bearer token)

`auth` (register/login/me/e2ee-setup/logout) · `users` (search, suggestions, profile, status-privacy, contacts, friend-requests, block) · `conversations` (list, direct, group + members/admins/leave, flag, clear, delete, folder) · `messages` (list, send, read, upload/media, edit, delete, react, forward, calls, media stats/list) · `status` (feed, create, view, react, delete) · `posts` (`feed?scope=all|contacts|discover&exclude=…`, user posts, get, create, edit, delete, like, comments) · `calls/ice`.

## Limits

100 MB per upload, 10 files per request · 6 posts per user · 5 active statuses per user.

## Troubleshooting

- **Call connects but no video/sound:** configure TURN (above); make sure the site is HTTPS; allow camera/mic; if the browser blocks autoplay, tap "Tap to enable sound".
- **Still seeing an old version:** the service worker updates automatically; a hard reload once (or clearing site data) clears builds from before this change.
- **CORS errors:** add your client origin to `CLIENT_ORIGIN`.

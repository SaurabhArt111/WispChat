# Wisp Chat

A MERN application — React (hand-written CSS, no Tailwind) + Node/Express/MongoDB + Socket.io.

## What's included

**Messaging core**
- 1:1 chats and groups (create, rename, add/remove members, leave, admins)
- Real-time delivery via Socket.io, with optimistic sending in the UI
- Typing indicators, online/last-seen presence
- Read receipts (double ticks) and delivery ticks
- Reply, edit, delete-for-me, delete-for-everyone, forward, emoji reactions
- Mute / pin / archive / clear chat
- Friend requests + contacts + user search
- Infinite-scroll message history

**The three features you asked for specifically**
1. **Paste/drag files straight from the OS** — `Ctrl/Cmd+V` a screenshot or a file copied from
   File Explorer/Finder directly into the chat, or drag a file from Explorer onto the chat
   window (there's a full-window drop overlay).
2. **Custom context menus everywhere** — right-click a message (reply/copy/edit/delete/forward/
   react), a chat in the sidebar (pin/mute/archive/clear), or your own avatar (profile/logout).
   It's one shared, reusable menu component (`ContextMenuContext`), not native browser menus.
3. **Pre-send media composer** — attaching, pasting or dropping media never sends immediately.
   It opens a dedicated full-screen composer where you can **crop, rotate, and free-hand draw**
   on images (canvas-based, with undo), add a caption, remove/add more files, then hit Send.

## Not included (flagged as follow-up work)

Voice/video calling (WebRTC) and end-to-end encryption existed in the original two apps but
were out of scope to rebuild here — the codebases were too large to safely merge in full. The
architecture (sockets, message model) leaves room to add these later.

## PWA (installable app)

The client now builds as a full Progressive Web App via `vite-plugin-pwa`:
- **Installable** on Android/desktop Chrome/Edge (custom in-app "Install Wisp" banner, driven by
  `beforeinstallprompt`) and on iOS/iPadOS via Add to Home Screen (a one-time in-app tip, since
  iOS Safari has no install-prompt API).
- **Standalone launch**, themed status bar, app icons (incl. Android maskable icons) and basic
  iOS splash screens — see `client/public/icons/`.
- **Offline-capable**: the app shell precaches on install; `/api/*` calls use a network-first
  strategy with a short-lived cache fallback; `/uploads/*` media uses cache-first (a given file
  never changes once uploaded); Google Fonts are cached too. `/socket.io/*` is never intercepted.
- **Auto-update with user control**: new deploys show a small "Reload to update" banner instead
  of silently swapping the app under the user (see `src/components/common/PwaManager.jsx`).

Nothing about routing, auth, sockets, or existing UI was changed to add this — it's additive.

## Liquid glass effect

`@ybouane/liquidglass` (WebGL refraction/blur/Fresnel glass) is applied to the chat header and
sidebar top bar via a reusable `<LiquidGlassPanel>` wrapper
(`src/components/common/LiquidGlassPanel.jsx`). It feature-detects WebGL2, respects
`prefers-reduced-motion`, and falls back to the app's existing plain CSS frosted-glass look if
the effect can't initialize for any reason — so it's purely a visual upgrade, never a hard
dependency.

## Media storage layout

Uploaded files are no longer dumped flat into `server/uploads/`. The upload middleware now
sorts every file into a type-specific subfolder as it's saved:

```
server/uploads/
  images/          regular photos
  gifs/            animated GIFs (kept separate from images/ for easy purging/CDN rules)
  videos/
  audio/           voice notes, audio attachments
  documents/       PDFs, zips, and anything else that isn't image/video/audio
  stickers/        reserved for a future sticker-pack feature
  profile-photos/  reserved for on-disk avatar storage (avatars are currently stored as
                   base64 data URLs on the User document, so this folder is unused for now —
                   wiring an avatar upload endpoint through it later is a drop-in change)
```

A "Media & Storage" chart in Profile & Settings visualizes this split (counts + size per media
kind), backed by a small aggregation endpoint (`GET /api/messages/media/stats`).

## Running it

### 1. Backend
```bash
cd server
cp .env.example .env
npm install
npm run dev
```
Requires a MongoDB instance — either local (`mongodb://127.0.0.1:27017/wispchat`) or a
connection string from MongoDB Atlas, set in `server/.env`.

### 2. Frontend
```bash
cd client
npm install
npm run dev
```
The Vite dev server proxies `/api`, `/uploads`, **and `/socket.io`** to
`http://localhost:5000`, so just open `http://localhost:5173` once both are running.
Both processes need to be running at the same time for realtime features (new messages,
reactions, typing, online status) to work — if only the frontend is running, or the
backend crashed/isn't reachable, those updates won't arrive until you refresh, since
refreshing falls back to a plain REST fetch. Watch the browser console for
`[socket] connection error: ...` if that happens — it means the backend isn't reachable
at `http://localhost:5000`.

### 3. Try it
Register two accounts (in two browser windows/incognito tabs), add each other via the
"New chat" search, and start messaging. Try right-clicking a message, pasting an image into
the composer, or dragging a file onto the chat window.

## Project structure
```
server/
  src/models/          User, Conversation, Message, FriendRequest
  src/controllers/      auth, users, conversations, messages
  src/routes/
  src/sockets/          realtime: presence, typing, message events
  src/middleware/       auth (JWT), upload (multer)
client/
  src/context/          Auth, Socket, Chat, ContextMenu, Toast
  src/components/Sidebar/     chat list, new chat/group, profile, friend requests, media stats
  src/components/Chat/        header, message list/bubble, composer, forward, lightbox
  src/components/MediaComposer/  pre-send editor + canvas image editor
  src/components/common/      shared UI incl. LiquidGlassPanel, PwaManager
  src/styles/            hand-written CSS, design tokens in tokens.css
  public/icons/           generated PWA icon set (see below)
```

App icons were generated from a single brand SVG (`client/public/icons` source design not
checked in — regenerate any time by editing an SVG and rasterizing with `sharp`, or swap the
PNGs directly) at every size `vite-plugin-pwa`'s manifest references, plus a maskable variant
with safe-zone padding for Android adaptive icons and a couple of basic iOS splash screens.

## Design system
Dark-mode-first "ink + mint glow" identity: `--ink`/`--surface` backgrounds, `--wisp` mint
accent for your own messages and primary actions, `--ember` for secondary highlights.
Headings use Space Grotesk, body text uses Inter. All tokens live in
`client/src/styles/tokens.css` if you want to reskin it.

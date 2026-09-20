# Wisp Chat

A merged, rebuilt chat app combining the best of **Wisp-PWA** and **Hello-Chat** into one
MERN application — React (hand-written CSS, no Tailwind) + Node/Express/MongoDB + Socket.io —
now extended into an installable, app-like PWA with a full navigation rail, 24h Status/stories,
per-chat contact info, and a redesigned delete/undo flow.

## What's included

**Messaging core**
- 1:1 chats and groups (create, rename, add/remove members, leave, admins)
- Real-time delivery via Socket.io, with optimistic sending in the UI
- Typing indicators, online/last-seen presence
- Read receipts (double ticks) and delivery ticks
- Reply, edit, forward (from the context menu **or** a hover quick-action button on every bubble),
  emoji reactions
- Mute / pin / archive / clear chat
- Friend requests + contacts + user search
- Infinite-scroll message history

**Deleting messages, done safely**
Deleting no longer fires instantly. It opens an action sheet — *Delete for everyone* (your own
messages) / *Delete for me* / *Cancel* — and even after you confirm, the message sits in a
"Deleting…" state for 3 seconds while a toast with an **Undo** button is shown. Only after that
window closes does it actually leave the server. The same `requestDeleteMessage` /
`undoDeleteMessage` pair in `ChatContext` is reusable anywhere else a "confirm, but let me take
it back" delete is needed.

**Navigation rail**
A slim icon rail (`AsideRail`) sits to the left of the chat list, matching the familiar
messaging-app layout: **Chats, Calls, Status, Groups**, then **Archived, Media & Storage,
Broadcast Lists**, and your **Settings/profile avatar** at the bottom.
- *Archived* and *Groups* were previously invisible in the UI even though the backend already
  supported pin/mute/archive per-conversation — they're now first-class views.
- *Media & Storage* surfaces the same per-type breakdown chart used in Profile & Settings.
- *Calls* and *Broadcast Lists* are honest "not built yet" placeholders rather than fake buttons
  — see "Not included" below.

**Status (24-hour stories)**
Full-stack: a `Status` model with a Mongo TTL index (documents expire themselves after 24h, no
cron needed), `GET/POST /api/status`, view tracking, and delete. On the client: "My Status" +
a scrollable list of contacts' updates with unseen/seen rings, a composer that reuses the same
crop/draw/rotate image editor as regular message attachments (plus a WhatsApp-style colored
text-status mode), and a full-screen viewer with segmented auto-advancing progress bars,
tap-to-navigate, hold-to-pause, and a view-count/viewer list for your own posts.

**Contact & group info panel**
Clicking the name/avatar in the chat header (or the info icon, or "Contact info"/"Group info" in
the "⋯" menu) now opens a real side panel next to the message list — profile photo, status line,
mute/pin/archive shortcuts, and **Media**/**Files** tabs listing everything shared in that
conversation, pulled straight from the messages already loaded in that chat.

**Its own context menu, everywhere**
The native browser right-click menu is suppressed app-wide (`ContextMenuContext` now also adds a
window-level `contextmenu` listener), and the custom menu now covers messages, sidebar chats,
your own avatar, **and attachments/media** (Reply, Forward, Copy image, Save as, Delete).

**Lightbox**
Rebuilt with scroll-wheel zoom (1×–6×), drag-to-pan once zoomed, double-click to toggle zoom,
arrow-key/swipe navigation between a message's images, and Forward/Download actions in the top
bar.

**Keyboard shortcuts**
- `Ctrl/Cmd+F` — always focuses the conversation-list search, even while a chat is open (doesn't
  get hijacked by the browser's own page-find).
- `/` — same, when nothing else is focused.
- `Esc` — closes whatever's open: a modal, the media composer (with a discard confirmation if
  you'd typed a caption or edited the image), the lightbox, the status viewer, or just blurs an
  active search box back to the chat.
- `Ctrl/Cmd+V` — paste a screenshot or copied file straight into the chat.

**Pre-send media composer**
Attaching, pasting or dropping media never sends immediately. It opens a dedicated full-screen
composer where you can crop, rotate, and free-hand draw on images (canvas-based, with undo), add
a caption, remove/add more files, then hit Send — and closing it with unsaved edits/caption now
asks first instead of silently discarding your work.

## Not included (flagged as follow-up work)

Voice/video calling (WebRTC), end-to-end encryption, and broadcast lists existed as ideas but
were out of scope to build here — the rail nav has honest placeholders for Calls and Broadcast
Lists rather than pretending they work. The architecture (sockets, message model, Status model)
leaves room to add these later.

## PWA (installable app)

The client builds as a full Progressive Web App via `vite-plugin-pwa`:
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

`@ybouane/liquidglass` (WebGL refraction/blur/Fresnel glass) is applied to the **chat header
only** via a reusable `<LiquidGlassPanel>` wrapper (`src/components/common/LiquidGlassPanel.jsx`)
— it was originally also applied to the sidebar's top bar, but having the effect on both bars at
once looked heavy-handed, so it's now a single, deliberate accent rather than a wall-to-wall
effect. The component feature-detects WebGL2, respects `prefers-reduced-motion`, and falls back
to the app's existing plain CSS frosted-glass look if the effect can't initialize for any
reason — so it's purely a visual upgrade, never a hard dependency.

## Media storage layout

Uploaded files are no longer dumped flat into `server/uploads/`. The upload middleware sorts
every file into a type-specific subfolder as it's saved:

```
server/uploads/
  images/          regular photos
  gifs/            animated GIFs (kept separate from images/ for easy purging/CDN rules)
  videos/
  audio/           voice notes, audio attachments, status media (video/audio)
  documents/       PDFs, zips, and anything else that isn't image/video/audio
  stickers/        reserved for a future sticker-pack feature
  profile-photos/  reserved for on-disk avatar storage (avatars are currently stored as
                   base64 data URLs on the User document, so this folder is unused for now —
                   wiring an avatar upload endpoint through it later is a drop-in change)
```

A "Media & Storage" chart (in Profile & Settings **and** its own rail entry) visualizes this
split — counts + size per media kind — backed by a small aggregation endpoint
(`GET /api/messages/media/stats`).

## App icon

The app icon is a simple, deliberately legible mark — a rounded chat bubble with three
typing-indicator dots and a small "wisp" trail — designed to read clearly at 16px as well as
512px. It's generated from `client/public/icons/*.svg`-equivalent source art via `sharp` into
every size the PWA manifest references, plus a maskable variant with safe-zone padding for
Android adaptive icons, a favicon.ico, and a handful of basic iOS splash screens.

## Running it

### 1. Backend
```bash
cd server
cp .env.example .env      # edit MONGO_URI / JWT_SECRET if needed
npm install
npm run dev                # nodemon, http://localhost:5000
```
Requires a MongoDB instance — either local (`mongodb://127.0.0.1:27017/wispchat`) or a
connection string from MongoDB Atlas, set in `server/.env`.

### 2. Frontend
```bash
cd client
npm install
npm run dev                # Vite dev server, http://localhost:5173
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
"New chat" search, and start messaging. Try right-clicking a message or an image, pasting a
screenshot into the composer, posting a Status, opening the contact info panel, or deleting a
message and hitting Undo before the 3-second window closes.

## Project structure
```
server/
  src/models/          User, Conversation, Message, FriendRequest, Status
  src/controllers/      auth, users, conversations, messages, status
  src/routes/
  src/sockets/          realtime: presence, typing, message events
  src/middleware/       auth (JWT), upload (multer, type-sorted storage)
client/
  src/context/           Auth, Socket, Chat, Status, ContextMenu, Toast
  src/components/Sidebar/     AsideRail, chat list, Archived/Groups/Media/Status panels,
                               StatusEditor/StatusViewer, new chat/group, profile, friend requests
  src/components/Chat/         header, message list/bubble, composer, forward, lightbox,
                               ContactInfoPanel
  src/components/MediaComposer/  pre-send editor + canvas image editor (also reused by Status)
  src/components/common/       shared UI: LiquidGlassPanel, PwaManager, ConfirmModal,
                               ActionSheetModal
  src/styles/            hand-written CSS, design tokens in tokens.css
  public/icons/           generated PWA icon set (see below)
```

## Design system
Dark-mode-first "ink + mint glow" identity: `--ink`/`--surface` backgrounds, `--wisp` mint
accent for your own messages and primary actions, `--ember` for secondary highlights.
Headings use Space Grotesk, body text uses Inter. All tokens live in
`client/src/styles/tokens.css` if you want to reskin it. The navigation rail, side panels, and
Status viewer all reuse these same tokens rather than introducing new colors, so they read as
part of the same product rather than bolted-on features.

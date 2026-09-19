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

Voice/video calling (WebRTC), end-to-end encryption, push notifications, and PWA/offline
support existed in the original two apps but were out of scope to rebuild here — the codebases
were too large to safely merge in full. The architecture (sockets, message model) leaves room
to add these later.

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
  src/components/Sidebar/     chat list, new chat/group, profile, friend requests
  src/components/Chat/        header, message list/bubble, composer, forward, lightbox
  src/components/MediaComposer/  pre-send editor + canvas image editor
  src/styles/            hand-written CSS, design tokens in tokens.css
```

## Design system
Dark-mode-first "ink + mint glow" identity: `--ink`/`--surface` backgrounds, `--wisp` mint
accent for your own messages and primary actions, `--ember` for secondary highlights.
Headings use Space Grotesk, body text uses Inter. All tokens live in
`client/src/styles/tokens.css` if you want to reskin it.

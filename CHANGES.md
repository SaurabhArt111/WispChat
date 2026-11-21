# WispChat — native Android update 5 (big emoji, camera, GIFs & stickers, media/links/docs)

- **Big emoji with no bubble**: a message of 1–3 emoji only is shown large (bigger for one) with no bubble behind it, just a small time pill —
  like WhatsApp. Stickers are shown the same way (borderless). GIFs now animate in the chat.
- **New in-app camera** (`ui/CameraScreen.kt`, CameraX): full-screen preview, tap to focus, pinch to zoom, double-tap to flip, flash
  (off / on / auto), Photo and Video modes with a recording timer, a strip of your **recent photos & videos** above the shutter and a gallery
  button. **Swipe up** (on the preview or the strip) opens the full **Recents** gallery with an album switcher and multi-select (up to 10).
  Asks for photo access once; without it the gallery button falls back to Android's photo picker.
- **Emoji panel** (`ui/ExpressionPanel.kt`): drag the handle up to expand it to most of the screen (down to shrink), WhatsApp layout with
  Recents + all categories in one scroll and a category bar, and working **GIF** and **Sticker** tabs (trending + search). Tap one to send it.
  GIF/sticker search goes through the server so no key ships in the app: **set `GIPHY_API_KEY` in `server/.env`** (free key from
  developers.giphy.com) — until then the tabs explain how to turn it on.
- **Contact info / Group info → "Media, links and docs"** with the 4 newest photos/videos in a row; tapping opens a **Media | Links | Docs**
  page (`ui/MediaDocs.kt`). Tapping a link or document jumps to that message in the chat (highlighted); a photo opens the viewer, which has a
  **Show in chat** button. Jumping loads older history automatically if the message isn't on screen yet. Lists what's stored on the phone.
- **Web**: videos in chat are now WhatsApp-style tiles in the media grid (real still frame, play button, length) that open in the full-screen
  viewer, instead of a small letter-boxed player in the bubble; the send-preview shows the whole video uncropped.
- **Server**: new `GET /api/gifs?type=gifs|stickers&q=` (GIPHY proxy, cached).
- New Android dependencies: CameraX 1.4.1, coil-gif, coil-video. New permissions: read photos/videos (for the camera's gallery strip).

Not built here (no Android SDK / Maven access): Kotlin files pass a compiler syntax check, and the web client builds. Test on a device:
camera photo + video + swipe-up gallery, emoji panel drag, a GIF send, Media/Links/Docs → tap a doc.

# WispChat — native Android update 4 (wallpapers, offline queue, icons, phone-like calls)

**Bugs from the screenshots**
- *"The coroutine scope left the composition"* toast: sending / uploading ran inside the chat screen, so leaving the chat cancelled it and the
  cancellation was shown as an error. Messages now send from the app's own background scope (leaving never cancels them) and no screen shows
  cancellation as an error any more (`toastErr`).
- Chat stuck on grey skeleton bubbles: the chat waited for the server (slow while Render wakes up) before showing anything. It now shows what's
  on the phone instantly and refreshes in the background; the header says *connecting…* while the server is unreachable.
- Contact info: the **Video** button wrapped letter by letter — Message · Audio · Video are now equal-width tiles.
- Explore: images that can't be loaded show an "image unavailable" mark instead of a blank grey box. (Blank posts usually mean the files are gone
  from the server: Render's free disk is wiped on every restart — see the note in `server/server.js`.)

**Wallpapers (same system as the web app)** — `ui/Wallpaper.kt`
- Global default (Settings → Chats → Default wallpaper) + per-chat override with **Use default** (chat ⋮ → Wallpaper).
- Every chat now starts with the **WispChat doodle pattern** (theme-aware, drawn on the phone). Also: Plain, Doodle grid, Midnight, Emerald Haze,
  Violet Dusk, Ember, Slate, six solid colours, and **your own photo** (with a dim slider). A *Doodles* switch adds the pattern over colour wallpapers.

**Offline: everything waits and is replayed in order** — `data/Pending.kt`, `data/SyncWorker.kt`
- Anything done while the server can't be reached (no internet *or* server down / asleep) is applied on the phone straight away and queued:
  reactions, edits, delete for me / for everyone, mark read, mute / pin / archive, folders, clear / delete chat, block, profile name / about / photo,
  status text / photo / video posts, status views / reactions / deletes, post likes, new posts, friend requests.
- When the server answers again the queue is replayed **one by one, oldest first** (messages keep their own outbox). A WorkManager job retries in
  the background even if the app is closed. Chat list and chat show "N pending" with a Retry button.

**Status expires after 24 h even offline** — every slide carries `expiresAt` (server sends it now; otherwise createdAt + 24 h) and the phone removes it the
moment it turns 24 h old, from the screen and from the on-device cache.

**Icons** — Rounded icon set throughout; the bottom bar uses **outlined icons normally and filled icons when active** (WhatsApp-style), with labels and a pill.

**Calls that behave like phone calls** — `call/*`
- Fixed: an incoming call while the app was **open** never rang (nothing showed it). It now opens the full-screen answer page.
- Rings with the phone's own ringtone + vibration (respects silent / vibrate), caller hears a ring-back tone ("Ringing…"), busy / ended tones,
  short vibration on connect, missed-call notification with **Call back**.
- **Custom call notification**: caller photo, "WispChat voice/video call · end-to-end encrypted", Answer / Decline, full screen over the lock screen,
  run from a `phoneCall` foreground service so it keeps ringing even if the app was closed. Ongoing call notification has photo, timer, **Mute · Speaker · Hang up**.
- Audio like the phone app: audio focus (music pauses), earpiece / speaker / Bluetooth / wired headset routing that follows headsets being plugged in,
  proximity sensor turns the screen off at your ear.
- New call screens: pulsing caller photo, Decline · Message · Answer, draggable self-view, auto-hiding video controls, audio-output picker,
  minimise (Back) keeps the call running.
- Settings → Notifications → Calls: "Allow full-screen incoming calls" shortcut (Android 14+ asks for it).

**Server**: status items include `expiresAt`; call pushes include `callerAvatar` (short URLs only) and `callerColor`.

**Not verified on a device** (no Android SDK / Maven access in this environment): every Kotlin file passed a parser check with the Kotlin 2.0 compiler,
but the project wasn't built. Build with Android Studio, then test: call with the app open / closed / screen locked, offline actions → back online.

# WispChat — update 3 (stability, notifications, calls, new identity)

**Renamed to WispChat** (user-facing; the Android package id stays `com.wispchat.app` so updates/installs keep working). New icon-only logo, launcher/splash/status-bar/favicon assets regenerated, icon-led sign-in/welcome/bottom-nav, refreshed theme (`styles/theme.css`).

**Server**: async route errors no longer crash the process (`utils/asyncErrors.js`); DB connect retries; 503 while DB is down; socket listeners registered before DB work; "Server busy" vs "Auth failed"; `.env` loaded before modules; placeholder TURN hosts ignored (set a REAL TURN for calls on mobile data).

**App**: login is only dropped on 401/403 (not on network errors); 35 s timeout + auto-retry for reads; chat list error/retry card; socket auto-retry after a server-side rejection; notification permission requested on every start until granted, with a "Turn on" prompt.

**Android native**: foreground-service start crash fixes (socket + call services), no fullscreen theme flag, message notifications shown unless that exact chat is open, mic-permission guard for the call service.

**Not verified on a device**: native Java was only syntax-checked (no Android SDK here). Rebuild with `npm run android:build`, then test: fresh install, message with app swiped away, call with screen locked.

# WispChat — update 2 (Android polish, no-Firebase notifications, routes, local-first)

See the "Update 2" section of **ANDROID-SETUP.md**.

# WispChat — Android app (Capacitor) + push + closed-app calls

See **ANDROID-SETUP.md**. Adds: `client/android` (Android Studio project, native Java: FCM service, ringing
full-screen call screen, foreground call service, WhatsApp-style storage folder), `client/src/native/*`
(plugin wrapper, media mirroring, backup, `useNativeApp`), Settings → General "Notifications & calls / Storage /
Back up chats" (Android only), server push (`utils/push.js`), `/users/push-token`, `/calls/:id/decline`, and ringing
calls that survive the callee's app being closed. The browser/PWA build is unchanged.

# WispChat — native-style TopSheet / BottomSheet (mobile module)

| What | Where |
|---|---|
| Reusable `BottomSheet` / `TopSheet` (shared `Sheet`): hidden · collapsed · half · expanded, spring animation, velocity-aware snapping, touch + mouse drag, Android-style nested scrolling, safe-area + on-screen-keyboard aware, focus trap/restore, grip is a keyboard-operable `separator` (arrows / Home / End), `prefers-reduced-motion` | `components/common/Sheet/*`, `styles/sheets.css` |
| Pure physics (spring, rubber-band, snap resolution, nested-scroll arbiter) | `utils/sheetPhysics.js` |
| Gesture/spring engine (writes transforms straight to the DOM, no React state per frame) | `hooks/useSheetEngine.js`, `hooks/useSheetViewport.js` |
| Esc + Android/browser Back close only the topmost modal sheet; history entry is removed again when closed another way; router untouched | `utils/sheetStack.js` |
| Adopted by: reaction picker (phones), post comments + edit-post sheets, More menu (bottom, or `from="top"`), action sheets (phones) | `ReactionPickerSheet`, `PostFeedPage`, `MoreMenuSheet`, `ActionSheetModal` |

Notes
- Desktop layouts are unchanged (`ReactionPickerSheet` / `ActionSheetModal` keep their centred cards at >= 859px).
- Sheets carry `role="dialog"` + `data-no-swipe`, so `useTabSwipe` / `useSwipeBack` already ignore them.
- `Modal` and the other full-screen pages still use their CSS slide animation; moving them onto `BottomSheet` is a drop-in follow-up.
- `npm run test:sheets` runs the physics unit tests (no new dependencies).
- Not yet tried on physical iOS / Android hardware.


---
# Native Android app (new): `android/`
Kotlin + Jetpack Compose client for the same Node backend (see `android/README.md` for scope and verification status).
Layout is now: `server/` (Node API, standalone) · `client/` (React web) · `android/` (native). `client/android` is the old
WebView shell, kept only until the native app has been validated — delete it afterwards.

# Native app update: offline-first + new Settings
On-device database and media store, offline outbox, auto-download rules, gallery saving, delete-for-me/everyone with
"also delete from device", light/dark theme and a WhatsApp-style Settings page. See `android/README.md`.


---
# Native Android app: feature parity with the web app
Rewrote the native UI around five swipeable tabs (Chats · Status · Explore · Calls · Profile) in the web app's dark theme, renamed
everything back to **WispChat**, and added Status, Explore / posts, Calls, Profile, Groups, Archived, Friend requests, Media & Storage,
Broadcast, Contact / Group info, edit-profile with avatar cropper, a complete chat screen (swipe-to-reply, long-press menu, reactions,
forward, edit, delete, media swipe viewer, voice notes, camera, wallpapers, search, drafts) and skeleton loading everywhere.
Notifications: Firebase push receiver (`notify/PushService`), token registration, the always-on "Connected" notification is now only a
silent fallback, and calls get a CallStyle ongoing-call notification. See `android/README.md` (also: add `google-services.json`).

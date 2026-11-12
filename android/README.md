# WispChat — native Android app (Kotlin + Jetpack Compose)

A real native client for the WispChat Node backend (`../server`). No WebView, no Capacitor. It follows the web app's
dark theme, pages and behaviour, with WhatsApp-style gestures.

## Build
1. Android Studio (Ladybug or newer) with JDK 17+, open this folder.
2. Backend URL: `gradle.properties` → `WISP_BACKEND` (or `./gradlew assembleDebug -PWISP_BACKEND=https://your-host`). HTTPS only.
3. **Push notifications (recommended, this is what makes messages arrive with the app closed):**
   1. Firebase console → create a project → *Add app → Android* → package name `com.wispchat.app`.
   2. Download `google-services.json` into **`android/app/`** and rebuild. (The build only applies the Google Services
      plugin when that file exists, so the project also builds without it.)
   3. Firebase → Project settings → *Service accounts → Generate new private key*; on the **server** set
      `FIREBASE_SERVICE_ACCOUNT_FILE` (or `FIREBASE_SERVICE_ACCOUNT_JSON`). The server logs `[push] Firebase Cloud Messaging ready`.
4. Run on a device/emulator (API 26+).

## Pages (all native)
| Tab / page | What's in it |
|---|---|
| **Chats** | search, All / Unread / Groups / folder chips, archived row, pin / mute / archive / folder / delete / clear, mark unread, skeleton loading, offline & error states, drafts, typing, online dots, long-press multi-select |
| **Status** | my status + contacts' statuses with segmented rings, text & photo/video status editors, full-screen viewer (tap / hold-to-pause / swipe-down), reactions, reply-to-status, viewers list, delete, **Status privacy** |
| **Explore** | For you / Friends / Discover grid with endless scroll, "N new posts" pill, people search, full-screen vertical post viewer (double-tap like, comments with edit / delete), new / edit / delete post |
| **Calls** | call log (All / Missed, search, endless), favourites row, new-call picker, call back voice / video, delete from log |
| **Profile** | avatar, @username (copy), about, posts grid, edit profile (name, about, accent colour, **pinch/drag avatar cropper**), friend requests, settings |
| Chat | see below |
| Other pages | Settings (account, privacy, chats, appearance, notifications, storage & data), New chat (contacts, suggestions, global search, add contact), New group, Groups, Archived, Contact info, Group info (rename, photo, description, admins, add / remove members, only-admins-can-send, leave), Friend requests, Media & Storage, Broadcast, Person profile |

## Gestures
- **Swipe left / right between tabs** (Chats ⇄ Status ⇄ Explore ⇄ Calls ⇄ Profile) or tap the bottom bar.
- **Swipe in from the left edge** to go back from any page.
- **Drag a message to the right to reply** (haptic tick), **long-press** for the menu: quick reactions · Reply · Copy · Forward ·
  Edit · Select · Save to device · Delete (for me / for everyone, optionally also from this phone).
- **Photos and videos open in a swipe-left/right viewer** over every media item in the chat; pinch / double-tap zoom, drag down to close, save, share.
- Chat list rows use **long-press multi-select** (pin / mute / archive / more) instead of per-row swipe actions, so swiping stays free for switching tabs.

## Chat screen
Presence / last seen / typing, voice & video call buttons, in-chat search with next/previous, day separators, reply quotes (tap to jump),
forwarded labels, edited labels, reactions, read ticks, link previews, image grids, video, voice-note player, files, call entries,
scroll-to-bottom button with unread count, endless history, wallpapers (same presets as web), emoji panel, camera, photo/video preview with
caption, documents, **voice notes**, edit & reply banners, per-chat drafts, offline outbox with retry.

## Notifications — why the old behaviour was wrong and what changed
- **"Connected" notification shown all the time:** the app's only way to get messages while closed was an always-on foreground
  service, and Android forces such a service to show a notification. With Firebase push registered (step 3 above) that service is
  **never started**, so there is no persistent notification at all — like WhatsApp. Without Firebase the service remains as a
  fallback, but it is now silent, minimised, hidden on the lock screen, and Settings → Notifications has *Hide the background
  connection notification*.
- **No notifications when the app is closed:** the server already sent FCM data pushes, but the app had no receiver for them.
  `PushService` now receives them (also with the app swiped away), decrypts the message on the phone, and shows a notification
  with inline Reply / Mark read. Calls ring full-screen over the lock screen with Answer / Decline.
- During a call there is a **WhatsApp-style ongoing-call notification** (caller, timer, red *Hang up*) and a green in-app *call bar*.
- Android blocks all background delivery for apps the user **force-stopped** (every app, not just this one); opening it once fixes that.
  Some phone brands also need the app excluded from aggressive battery saving.

## Offline-first
Chat list, messages and downloaded media live on the phone (`data/LocalDb.kt`, `data/MediaCache.kt`); the app opens instantly with no
internet, encrypted chats stay ciphertext at rest, messages written offline go through an outbox and send automatically.
Auto-download rules, gallery saving, delete-for-me/everyone with "also delete from device" and per-chat storage cleanup are in Settings.

## Not ported yet
GIF / sticker search, image drawing & crop tools in the status / chat composer, Google sign-in, "star messages", disappearing messages,
and group voice / video calls (the web app doesn't have them either).

## IMPORTANT — verification status
This project was written **without an Android SDK or Maven access, so it has not been compiled or run.** I checked brace balance, every call
into `Repo` / `Social` / `Settings`, imports and duplicate declarations with scripts, but expect a first-build round of small fixes
(a missing import, a changed Compose signature). What *is* verified: the encryption module, by running the real web crypto code
against the Kotlin implementation (`tools/crypto-crosscheck/run.sh`).

## Calls on mobile data
Set a real TURN server in `../server/.env` (`TURN_URLS`, `TURN_SECRET`), otherwise calls only connect on friendly networks.

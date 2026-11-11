# Pingo — native Android app (Kotlin + Jetpack Compose)

A real native client for the Pingo Node backend (`../server`). No WebView, no Capacitor.

## Build
1. Android Studio (Ladybug or newer) with JDK 17+, open this folder.
2. Point it at your backend — default is in `gradle.properties` (`PINGO_BACKEND`). Override with
   `./gradlew assembleDebug -PPINGO_BACKEND=https://your-host`. HTTPS only (cleartext is blocked).
3. Run on a device/emulator (API 26+).

## What is implemented (phase 1)
| Area | Status |
|---|---|
| Sign in / register, Keystore-backed secret storage | ✅ |
| End-to-end encryption, wire-compatible with the web app (ECDH P-256 + HKDF + AES-GCM, PBKDF2 key wrap) | ✅ **verified against the web `crypto.js` in both directions** (`tools/crypto-crosscheck`) |
| Chat list, unread badges, typing, live updates (Socket.IO) | ✅ |
| Chat screen: text, photos/videos/files (encrypted upload), read ticks | ✅ |
| Message notifications with inline Reply + Mark read, shown with the app closed (background socket service, no Firebase needed), real decrypted text | ✅ |
| Voice & video calls (WebRTC), same signalling as web → native↔web works | ✅ |
| Full-screen incoming-call over lock screen, Answer/Decline from notification, ongoing-call service | ✅ |
| Auto-retry while a sleeping host wakes; socket auto-reconnect | ✅ |

## Offline-first (new)
- **Everything is stored on the phone.** Chat list, messages and downloaded media are kept in an on-device database
  (`data/LocalDb.kt`) and a private media folder (`data/MediaCache.kt`). The app opens instantly with no internet;
  the network only refreshes it in the background.
- **Secure at rest.** Encrypted chats are stored as ciphertext and decrypted in memory with the key from the Android
  Keystore. Downloaded media stays encrypted on disk; a readable copy is made only when you save it.
- **Offline sending.** Messages and attachments written offline wait in an outbox (clock icon) and send automatically
  when the connection returns. If the server rejects one it shows "Failed — tap to retry".
- **Media control.** Settings → Storage and data → auto-download for mobile data / Wi-Fi / roaming (none, photos, all);
  anything not auto-downloaded shows a download button. *Media visibility* (Settings → Chats) copies new media into the gallery;
  long-press a message → *Save to gallery / Downloads* for one-off saves.
- **Delete options.** Long-press → Delete: *Delete for me* (this phone only, stays gone after sync) or *Delete for everyone*
  (your own messages, needs internet) — each with a checkbox to **also delete the files from this phone and the gallery copy**.
  Also: *Remove downloaded files from this phone* (keeps the message), per-chat storage cleanup, *Delete all downloaded media*, *Clear all chats*.
- **Settings** modelled on WhatsApp's: Account, Privacy (blocked accounts), Chats, Appearance (light/dark/system, font size),
  Notifications (tones via system channel settings), Storage and data (manage storage, network usage, auto-download), App language, Help.

## Not yet ported from the web app (next phases)
Group creation/management, statuses/stories, explore/posts, message edit/delete/react/forward, reply-to UI,
drawing/crop tools, stickers/GIFs, voice notes, contacts/friend requests, block list, link previews,
call history screen, media gallery, Google sign-in, FCM (needed only if you want delivery when Android kills the background service).

## IMPORTANT — verification status
This project was written without an Android SDK available, so **it has not been compiled or run** (the offline database SQL was tested separately against real SQLite). Expect a
first-build round of small fixes (imports, API signatures). What *is* verified: the encryption module, by running
the real web crypto code against the Kotlin implementation (`tools/crypto-crosscheck/run.sh`).

## Calls on mobile data
Set a real TURN server in `../server/.env` (`TURN_URLS`, `TURN_SECRET`), otherwise calls only connect on friendly networks.

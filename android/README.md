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

## Not yet ported from the web app (next phases)
Group creation/management, statuses/stories, explore/posts, message edit/delete/react/forward, reply-to UI,
drawing/crop tools, stickers/GIFs, voice notes, contacts/friend requests, block list, link previews,
call history screen, media gallery, Google sign-in, FCM (needed only if you want delivery when Android kills the background service).

## IMPORTANT — verification status
This project was written without an Android SDK available, so **it has not been compiled or run**. Expect a
first-build round of small fixes (imports, API signatures). What *is* verified: the encryption module, by running
the real web crypto code against the Kotlin implementation (`tools/crypto-crosscheck/run.sh`).

## Calls on mobile data
Set a real TURN server in `../server/.env` (`TURN_URLS`, `TURN_SECRET`), otherwise calls only connect on friendly networks.

# WispChat for Android — setup guide

The Android app is your existing web app wrapped with **Capacitor**, plus a native layer
(`client/android/app/src/main/java/com/wispchat/app/`) for the things a browser can't do:
a storage folder, push notifications that work with the app closed, and a ringing
full-screen call screen.

```
client/                      web app (React) + Capacitor
client/android/              ← open THIS folder in Android Studio
server/                      Node server (now sends push notifications)
```

## 0. What you need
- Android Studio (current stable — Capacitor 8 needs a recent one) with **JDK 21** (bundled) and Android SDK 36
- Node 22+
- A **Firebase** project (free) — only for push notifications
- Your server reachable over **HTTPS** (a phone can't use `localhost`)

## 1. Point the app at your server
Edit `client/.env.android`:
```
VITE_BACKEND_URL=https://your-server.example.com
```
The Android app contains its own copy of the web UI, so it must be told where the server is.
Then add the **same server's** Firebase key (step 2) and deploy the server.

## 2. Firebase (push notifications + calls ringing when the app is closed)
1. https://console.firebase.google.com → create a project → **Add app → Android**
   - package name: `com.wispchat.app`
2. Download **`google-services.json`** → put it in `client/android/app/google-services.json`
3. Project settings → **Service accounts → Generate new private key**. On the **server** set one of:
   ```
   FIREBASE_SERVICE_ACCOUNT_FILE=/etc/secrets/wispchat-firebase.json
   # or the JSON itself (raw or base64):
   FIREBASE_SERVICE_ACCOUNT_JSON=...
   ```
   Restart the server — it logs `[push] Firebase Cloud Messaging ready`.
   (Without these, everything else works; the app just gets no notifications while closed.)

## 3. Build
```bash
cd client
npm install
npm run android:build     # builds the web UI in "android" mode and copies it into client/android
npm run android:open      # opens Android Studio
```
In Android Studio: wait for Gradle sync → pick a phone/emulator → ▶ Run.
Re-run `npm run android:build` whenever you change the web code.

### Installable APK
- Quick test APK: **Build → Build Bundle(s) / APK(s) → Build APK(s)** → `app/build/outputs/apk/debug/app-debug.apk`
- Release: **Build → Generate Signed Bundle / APK** (create a keystore **and back it up** — you need the same one for every update).
  Use an **.aab** for Google Play, an **.apk** to share directly.
- Release builds only allow HTTPS (debug builds also allow plain http for LAN testing — if you test with an http
  server also set `"androidScheme": "http"` in `client/capacitor.config.json`, then `npx cap sync android`).

## 4. Server
```bash
cd server && npm install && npm start     # npm test runs the 14 server tests
```
New in the server: `POST/DELETE /api/users/push-token`, `POST /api/calls/:id/decline`, push sending
(`src/utils/push.js`) and ringing calls that survive the callee's app being closed (`src/sockets/index.js`).
The Android app's origin (`https://localhost`) is allowed by CORS automatically.

## What the app does on the phone

### The WispChat folder (like WhatsApp)
```
Internal storage/Android/media/com.wispchat.app/WispChat/
  Media/  WispChat Images · WispChat Video · WispChat Audio · WispChat Voice Notes
          WispChat Documents · WispChat Animated Gifs · WispChat Stickers
          WispChat Profile Photos · WispChat Status        (Images/Video/Audio/Documents have a Sent/ folder)
  Databases/  call-log.json
  Backups/    WispChat-backup-YYYYMMDD-HHMM.json
```
- Created on first launch. Files are named like `IMG-20260131-WC0007.jpg`; documents keep their name.
- Photos, videos and audio you open or receive are saved automatically (switch off in **Settings → General**);
  documents are saved when you tap Save/Download. Encrypted (E2EE) media is saved **decrypted**, so it opens in
  any gallery/player. Anyone with access to the phone's storage can read that folder — same as WhatsApp.
- **Why `Android/media/…` and not `/sdcard/WispChat`?** Since Android 10 apps can't create their own top-level
  folders; `Android/media/<package>/` is the sanctioned place (WhatsApp uses it too). It needs **no storage
  permission**, shows up in file managers, and the gallery indexes images/videos in it. On Android 9 and older the
  folder is created at the top level (`/WispChat`).
- **Call logs**: your WispChat call history (not the phone's SIM call log — reading that needs a permission Google
  Play restricts) is written to `Databases/call-log.json` and included in backups.
- **Chats**: your chats live on the server (so they follow you across devices). **Settings → General → Back up now**
  writes a copy to `Backups/`. E2EE messages stay encrypted inside the backup.

### Notifications
- Messages arrive as Android notifications grouped per chat (**Mark as read** button) even if the app is closed
  or removed from Recents. Tapping opens that chat.
- Because messages are end-to-end encrypted, the server **cannot** put message text in a notification: you see the
  sender and "New message" (or 📷 Photo / 🎤 Voice message). Non-encrypted messages show a preview.
- **Incoming calls** ring with the ringtone + vibration and open a full-screen Accept / Decline screen over the lock
  screen. Decline works without opening the app. Accept starts the app and joins the call. The ring stops if the
  caller hangs up, you answer on another device, or 45 s pass.
- During a call a foreground service keeps the microphone/camera alive if you switch apps.

### Other
- **Back** closes sheets/dialogs, goes back a screen, and at the top level minimises the app (doesn't quit).
- Camera, microphone and file picking use Android's normal permission prompts / system picker.

## Limits you should know about
- **Force stop**: if the user force-stops the app in Android settings, Android blocks all background delivery for
  every app until it is opened again. Swiping from Recents is fine.
- **Aggressive battery managers** (Xiaomi, Oppo, Vivo, Huawei, some Samsung): ask users to set WispChat battery to
  "Unrestricted" (Settings → General has a shortcut). Without it those phones may delay pushes.
- **Android 14+** may require the user to allow "full-screen notifications" for the call screen (Settings → General
  has a shortcut). Otherwise a call shows as a heads-up notification with Accept/Decline.
- Calls use WebRTC through the WebView. For calls to work between people on mobile data you need a **TURN server**
  (`TURN_URLS` … in `server/.env.example`).
- iOS is not included.

## Not yet verified (no Android SDK was available where this was built)
The web app, the server and the call/push logic are tested (see below). The **native Java was compile-checked
against Android API 23 plus stubs but never built with Gradle or run on a device/emulator.** Expect to spend some
time on first build: a missing import or a Gradle version nit is possible. Please test on a real phone:
1. fresh install → folder appears, notification prompt shows
2. send a message from another account with the app swiped away → notification
3. call from another account with the app swiped away / screen locked → full-screen ring, Accept joins the call
4. open a photo → file appears in the folder / gallery

## Tests
- `server`: `npm test` — 14 tests (real Socket.IO + fakes): closed-app call ringing, buffered ICE, REST decline,
  push payloads, mute/block filtering, dead-token cleanup
- `client`: `npm run test:sheets` — sheet physics (18)

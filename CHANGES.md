# Pingo — update 3 (stability, notifications, calls, new identity)

**Renamed to Pingo** (user-facing; the Android package id stays `com.wispchat.app` so updates/installs keep working). New icon-only logo, launcher/splash/status-bar/favicon assets regenerated, icon-led sign-in/welcome/bottom-nav, refreshed theme (`styles/theme.css`).

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

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


# WispChat — revision 4 (one menu per message, device-driven call framing)

| Issue | Fix | Where |
|---|---|---|
| Two different context menus on one message (one on the photo, another on the bubble) | One menu per message: reactions + Reply / Copy / Forward + (if you clicked an attachment) Open in new tab, Copy image, Save as…, File info + Select / Delete | `Chat/MessageBubble.jsx`, `Chat/AttachmentView.jsx` |
| Phone's video not shown vertically | Framing now follows the DEVICE, not just the pixels: an upright phone is always a vertical 9:16 frame (cropped if its camera sent a wide picture); everything else is horizontal. On a wide screen the phone's picture is a centred tall column over a blurred backdrop; on a phone screen a computer's wide picture is shown whole, full width. Same orientation as the screen → fills it. Self-view follows the same rule. Double-click / More → Fill screen toggles | `Call/CallOverlay.jsx`, `styles/callLayout.css` |

Note: a phone still running an old build (screenshots showed the old call layout) must be refreshed ONCE — close the app fully and reopen it, or Chrome → ⋮ → reload. After that, updates arrive with a popup.

# WispChat — smoothness, PWA updates & phone↔desktop video (revision 3)

| Issue | Fix | Where |
|---|---|---|
| Phone sent a **landscape** picture (self-view was a wide box, desktop got a wide frame) | A phone held upright now crops its camera to a true 9:16 frame before sending, so its own preview is vertical and the desktop shows it as a vertical picture (centred, blurred sides). Desktop stays landscape. Works with camera flip / camera-on-mid-call | `utils/portraitTrack.js`, `CallContext.jsx` |
| Name / "Connecting… Computer" text sat under the buttons in video calls | Pinned to the top over the picture | `styles/callLayout.css` |
| "Connecting…" could stay forever on some phones | Also uses the ICE connection state as a second "connected" signal | `CallContext.jsx` |
| **Flicker when sliding between pages** (destination remounted and showed skeletons again) | Opened tabs stay mounted (hidden) on phones; the page sliding in beside you is the *same* instance that becomes the active page, so nothing reloads. Tapping a bottom-nav tab now slides exactly like a swipe | `pages/ChatApp.jsx` (`tab-slot`, `changeTab`), `styles/layout.css`, `hooks/useTabSwipe.js` |
| **PWA not picking up updates on mobile / no popup** | Config was `autoUpdate` + `skipWaiting`, which made the "Update available" card impossible. Now: new version waits → card appears (Update now / Later = snooze 20 min). Checks on start, every 5 min, on returning to the app, on focus, on reconnect. If the app is cold-started with an update already waiting it switches silently. Settings → General shows version/build and a **Check for updates** button | `vite.config.js`, `utils/pwaUpdate.js`, `PwaManager.jsx`, `SettingsModal.jsx` |

Notes
- Deploy the new build once; phones on the OLD build need one manual refresh/reinstall to receive the new update logic — after that updates arrive by themselves.
- Make sure your host serves `/sw.js` with `Cache-Control: no-cache`.
- Not tested on physical devices.

# WispChat — WhatsApp-parity update

| Request (from your videos / screenshots) | Where |
|---|---|
| Tabs slide with your finger; the next page is right beside the current one, springs back or settles on release | `hooks/useTabSwipe.js`, `pages/ChatApp.jsx` (`renderPanel`, `.tab-peek`), `styles/layout.css` |
| Media viewer: swipe left/right through **all photos/videos in the chat** with a gap between pages and edge rubber-banding; swipe up/down to dismiss (picture shrinks, backdrop fades); single tap hides controls, double tap zooms; animated open/close | `Chat/Lightbox.jsx`, `styles/lightbox.css`, `context/GalleryContext.jsx`, `Chat/AttachmentView.jsx` |
| Media file missing → tapping it opens a dialog ("Sorry, this media file isn't available…" + OK) and returns to the chat | `Lightbox.jsx` (`lb-dialog`), `AttachmentView.jsx` |
| Swipe a message right to reply (reply arrow pops in, haptic at threshold, bubble springs back) | `hooks/useBubbleGestures.js`, `styles/reactions.css` |
| Long-press a message → selection mode: top action bar (Reply · Copy · Forward · Delete), reaction row floats above the message with a **+** that opens the full emoji picker | `MessageBubble.jsx`, `MessageList.jsx`, `QuickReactions.jsx`, `ReactionPickerSheet.jsx` |
| Reaction row order now matches WhatsApp: 👍 ❤️ 😂 😮 😢 🙏 | `QuickReactions.jsx` |
| Green **call-in-progress bar** at the top while a call is minimised (mute · name – Ringing/timer · hang up); tap to return to the call; whole app is pushed down so nothing is covered | `Call/CallBar.jsx`, `styles/callBar.css`, `CallContext.jsx` (`minimized`) |
| **Phone ↔ computer video calls**: each side announces its device type + orientation (and updates when rotated); the real pixel shape of each stream is measured. Matching shapes fill the screen; mismatched (portrait phone on a landscape monitor, or the reverse) are *fitted* in full over a blurred backdrop. Self-view takes the shape of its own camera (tall on phones, wide on computers). Phones capture 9:16, computers 16:9. A device chip ("Phone"/"Computer") shows in the call header; More → *Fill screen / Fit whole picture* (or double-click the picture) | `utils/device.js`, `CallContext.jsx`, `Call/CallOverlay.jsx`, `styles/callLayout.css`, `server/src/sockets/index.js` (`call:device`, `device` on invite/answer) |

## Changed behaviour
- Drag-to-close for the chat now only starts from the left edge / header / composer, because dragging a message right now means *reply*.
- The old floating "minimised call" pill is replaced by the call bar.
- Old lightbox CSS removed from `chat.css` (now `lightbox.css`).

## Notes
- Server needs a restart (new `call:device` event; `device` field on invite/answer, sanitised server-side).
- Tab swipe previews Chats / Status / Explore / Calls side by side; Profile is a full page and switches with the existing slide.
- Not verified on physical devices — please test the swipe gestures and a phone↔desktop call.

# WispChat — latest update

| Request | Where |
|---|---|
| Tap a quoted reply → go to that message. Near = smooth scroll, far/long way up = instant jump (then re-centres). Older, not-yet-loaded history is fetched automatically until the message is found; toast if it was deleted | `Chat/MessageList.jsx#handleJumpToMessage` |
| Calls page loads fast: first 20 logs, header block (New call / Favourites / filters) paints instantly, only the rows show a skeleton | `Sidebar/CallsPanel.jsx` |
| Drag the chat window right to close it, like the mobile drawer (follows the finger, chat list revealed underneath with parallax, fling or >1/3 width closes, otherwise springs back) | `hooks/useSwipeBack.js`, `styles/layout.css`, `pages/ChatApp.jsx` |
| Select option is now a rounded square with a tick | `styles/improvements.css` (`.select-check`) |

## Extra fixes
- Calls: the header used to be an inline component, so it re-mounted on every render (the "whole page pauses" feeling). Virtuoso components are now module-level and the header is passed through `context`.
- Calls: background refresh no longer throws away older pages you already scrolled through.
- Chat: vertical scrolling is unaffected; horizontal scrollers, inputs, video and open dialogs are ignored by the drag-to-close gesture.

# WispChat — this revision

## New environment variables
- `server/.env` → `GOOGLE_CLIENT_ID` (enables "Continue with Google"; add your site under *Authorised JavaScript origins* in Google Cloud Console)
- `client/.env` → `VITE_GIPHY_API_KEY` (optional, enables the GIF tab)

## Requested items
| Request | Where |
|---|---|
| Links open in a new page + show content | `utils/linkify.js`, `Chat/LinkPreviewCard.jsx`, `server/src/utils/linkPreview.js` (SSRF-guarded), Settings → Chats → "Link previews" toggle |
| Hold status to pause (mouse + touch) | `Sidebar/StatusViewer.jsx` (also Space = pause) |
| 9:16 status upload with crop | `MediaComposer/StatusCropper.jsx` (pan / zoom / rotate / Fill-Fit); video gets 9:16 framing |
| Google sign-in | `server/.../authController.js#googleLogin`, `pages/AuthPage.jsx`, `AuthContext` (encryption-passcode step keeps E2EE intact) |
| Bigger bottom nav + search bar | `styles/improvements.css` §1 |
| Mobile max width +90px | breakpoint 768 → 858 everywhere |
| Settings back button, `/archived` route | `SettingsModal.jsx`, `ChatApp.jsx` |
| Better pin / archive | swipe actions, full-swipe archive, optimistic + Undo (`ConversationItem.jsx`) |
| Faster Calls page + more features | cached + skeleton, All/Missed, grouped, call-back, favourites, New call sheet, indexed + slimmer query |
| Draft system | `utils/drafts.js`, `Composer.jsx`, "Draft:" in chat list |
| Explore: friends mixed / no self posts / discover strangers | `postController.js`, `ExplorerPanel.jsx` |
| Page-specific menus | `Sidebar/PanelMenuButton.jsx` used by every panel |
| Status comments + emoji reactions | `StatusViewer.jsx` reply bar + "Tap to send"; delivered as encrypted chat messages tagged with the status (`Message.statusReply`) |
| Call page → place calls directly | Calls → New call / favourites / call-back |
| Telegram-style archive pull & swipe | `Sidebar.jsx`, `ConversationItem.jsx` |
| Emoji like the reference | `Chat/EmojiPanel.jsx` (Emoji / GIF / Stickers + recents), big emoji-only messages |
| Media · Docs · Links | `Chat/ContactInfoPanel.jsx` |
| WhatsApp-style call screen | `Call/CallOverlay.jsx` (Speaker, Video, Mute, More, Share screen, End, minimise) |
| `installMediaFallbacks()` | `src/lib/mediaFallback.js`, installed in `main.jsx` |

## Bugs found and fixed along the way
- Pin/mute/archive endpoint did not verify you were a participant of the conversation.
- `sendMessage` used a stale conversation list for brand-new chats, so the first message could be encrypted for the wrong recipients (affected Broadcast too).
- Explore "For you" explicitly included your own posts.
- Chat header text collapsed at tablet widths (desktop layout was used below ~860px).

---

# Revision 2 (fixes from screenshots + screen recording)

| Issue seen | Fix |
|---|---|
| Swiping a chat row also dragged the blue "Release for archive" bar | Pull gesture now direction-locks (must be clearly vertical); row swipe needs clearly horizontal (`Sidebar.jsx`, `ConversationItem.jsx`) |
| Blue Archive sliver visible on a resting row | Swipe action panels are hidden unless the row is moved |
| Status privacy: avatars stretched into ovals, no visible selection | `.privacy-contact span{flex:1}` was matching the avatar `<span>`; fixed + real tick circles. Global `.avatar{flex-shrink:0}` guard |
| Video call: huge control panel covering the picture | Video calls use a small icon-only pill bar (Mute · Camera · Flip · Speaker · More · End) that auto-hides after ~4.5 s and returns on tap. Voice calls keep the big grid. Safety code moved into More; self-view moved top-right; remote video now fills the screen |
| Call menu features not really working | **Video** in a voice call now truly adds your camera (renegotiates; the other side switches to video too). **Speaker** = real volume boost (Web Audio). **Share** works from voice or video calls where the browser supports screen capture (hidden on phones whose browsers don't; "Chat" shown instead). **More** → Switch camera, Share screen, Open chat, Minimize, Audio output |

---

# Revision 3

| Issue | Fix |
|---|---|
| "Couldn't decrypt" on files that are actually missing (404) | `utils/fetchMedia.js` checks the HTTP status, retries transient/QUIC failures with backoff, and `useDecryptedMediaUrl` returns `errorCode` (missing / network / locked / decrypt). `AttachmentView` shows the real reason + Retry |
| `ERR_QUIC_PROTOCOL_ERROR` | Transient Chrome↔host HTTP/3 failure; media fetches now retry (last try cache-busted) |
| 404 on `/uploads/...` | Server answers missing files with a clean cached JSON 404; client remembers known-missing URLs. **Root cause: Render's disk is ephemeral** — attach a persistent disk and set `UPLOAD_DIR`, or use S3/R2/Cloudinary. Old files already lost can't be recovered |
| Chat-row swipe | Haptics + magnetic detents (closed / open / full-archive), springy settle, icon pop; right-click mid-drag no longer flashes the context menu or freezes the row |
| Emoji / GIF / Sticker | WhatsApp Web layout: category icon bar, rounded search, bottom Emoji·GIF·Sticker switch |
| Call pickup | Slide-to-answer (or tap/Enter on knob), separate Decline button, avatar ripple rings |
| File bubbles | WhatsApp-style Open / Save as… buttons |
| Contact info | Notification settings + Encryption rows |

---

# Revision 4 (mobile gestures)

| Feature | Details |
|---|---|
| Swipe between tabs | Chats → Status → Explore → Calls → Profile. Swipe left/right on any non-scrolling area; on chat rows start the swipe at the screen edge (rows keep their own pin/mute/archive swipe). Slide animation + light haptic |
| Swipe out of a chat | Swipe right (from the left half) to go back to the chat list |
| Side drawer | In a chat, swipe left (from the right half) to open the navigation drawer. Close by tapping outside, swiping it right, Esc, or choosing an item |
| Profile tab | 5th button in the mobile bottom nav (your avatar) |
| Explore post viewer (mobile) | Reel/snap layout replaced with a normal scrolling feed of post cards (header, media, like/comment/share, likes, caption, comments link). Opened post is first |
| Message double-tap/click | On the bubble → reaction bar. On the empty part of the row → reply |
| Select messages | "Select" in the message menu → multi-select with Copy / Forward / Delete (+Undo) |
| No text selection on mobile | Bubble text isn't selectable on touch devices (use the menu → Copy) |
| Link card | Now above the message text |
| My profile | Smoother scroll (momentum, overscroll contain), sticky Posts tab bar, back-to-top button, bottom padding for the nav bar |

---

# Revision 5

| Item | Details |
|---|---|
| New chat is a route | `/new` (and `/new/call`). Back button / swipe-back closes it and returns to the page it was opened from; the previous page stays rendered underneath |
| Direct call buttons | Every contact row in New chat has voice + video call buttons. `/new/call` ("New call") lists contacts only and tapping a row calls them. Calls tab has a floating "new call" button on phones |
| Selecting messages | Bubbles no longer jump to one side — the checkbox is pinned to the left edge and each bubble keeps its own side |
| Mobile post viewer | Opens like Instagram: scrolling post cards with the tapped post in place, earlier posts above, later ones below. Media reserves space with a shimmer while loading (no more empty/black gaps); missing files show a "File unavailable" tile |

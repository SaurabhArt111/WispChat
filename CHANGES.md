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

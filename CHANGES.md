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

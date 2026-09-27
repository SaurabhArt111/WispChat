# What changed in this update

_This build merges two independent sets of changes: mine (routing, wallpapers,
group admin roles, call fixes) and yours (clipboard-copy rewrite, mobile
contact-info back button, clickable member preview, enter-to-send toggle,
lightbox/composer polish). Merged via git (`base` → `claude-update` +
`user-update` → merge commit); only one real conflict, in `chat.css`, where
both sides had appended new rules to the end of the file — resolved by
keeping both. `Composer.jsx`, which both of us edited heavily, merged
cleanly with no lost functionality on either side. Full history is preserved
if you want to inspect it — see the note at the bottom of this file._

## Routing
- Opening a chat now pushes a real URL: `/chat/:conversationId`. Back/forward
  and direct links to a chat work.
- `Groups`, `Status`, `Media`, `Calls`, `Broadcast` and `Settings` are now
  routes too (`/groups`, `/status`, `/media`, `/calls`, `/broadcast`,
  `/settings`). Closing Settings returns you to whatever route you were on.
- **Archived was deliberately left out of routing**, per the request — it's
  still a local panel toggle reached from the link inside the chat list,
  same as before.

## Wallpaper
- Settings → Chats now has a real wallpaper picker (presets + custom photo
  upload) that sets the **default for every chat**.
- Each chat's "More" menu (⋮ in the chat header) has "Chat wallpaper" to
  override the default for just that conversation.
- Stored per-device in `localStorage` (this is a personal display
  preference, not data that needs to sync to the other participant or
  across your own devices).

## Group roles (admin system)
- Promote/demote admins from Group Info (`PATCH /conversations/group/:id/admins`).
  A group can never be left with zero admins — you must promote someone else
  before demoting the last one.
- Add members to an existing group (previously you could only remove them).
- Group icon upload, reusing the same crop UI as your profile photo.
- New "Only admins can send messages" toggle (announcement-group mode),
  enforced both in the UI (Composer locks for non-admins) and on the server
  (`sendMessage` rejects it), not just the client.

## Calls
- Reviewed `CallContext`/`CallOverlay`/server call signaling: 1:1 voice/video
  over WebRTC with ringing, busy/timeout handling, mute/camera-off, and a
  safety-code verification UI were already solid.
- Fixed a real gap: a connection that dropped (`disconnected`/`failed`) used
  to sit on "Reconnecting…" forever with no recovery attempt. It now calls
  `pc.restartIce()` and gives it 15s to recover before ending the call
  and telling the user.
- Settings → Calls used to say calling "isn't built yet" — replaced with
  accurate info (mic permission status, and a note that calls use STUN only,
  so a small number of strict/symmetric-NAT networks may need a TURN relay
  to connect — that's a server-side addition, not in this update).

## Not changed / known limitations
- **`manifest.webmanifest` CORS error**: that's Vercel's *Deployment
  Protection* redirecting requests through `vercel.com/sso-api` — it's a
  project setting on Vercel's dashboard, not a bug in this app's code.
  Disable/adjust Deployment Protection for the production deployment (or
  add a bypass token) and it goes away.
- Group calling (more than 2 people) is still not implemented.
- No TURN server is configured; calls across strict corporate NATs may
  still fail to connect (STUN-only).

## Verified
- `npm run build` in `client/` completes cleanly with these changes.
- Edited server files pass a Node syntax check.

## Your changes (kept as-is)
- `client/src/utils/copyImage.js`: new dedicated "copy image to clipboard"
  helper — decodes to a canvas and re-encodes as PNG before
  `navigator.clipboard.write`, which is more broadly supported than copying
  the original blob type directly (was previously inlined in
  `AttachmentView.jsx`).
- `ContactInfoPanel.jsx`: mobile back button in the panel header, and the
  group member-avatars preview is now clickable and opens Group Info.
- `Composer.jsx`: an enter-to-send toggle button next to the input.
- `Lightbox.jsx` / `base.css` / `liquidglass.css`: assorted visual polish.

## Git history
A full git history (base → my changes → your changes → merge) is included
in this zip as a `.git` folder, in case you want to inspect exactly what
changed and by whom, or cherry-pick/revert something later.

---

## Round 3 (this update)

**Done:**
- **Image grid bug (the "+1 blocks clicks" screenshot)** — the "+N more"
  overlay was `position:absolute; inset:0` as a *sibling* of the grid tiles,
  so it covered all 4 thumbnails instead of just the last one. Fixed by
  nesting it inside the 4th tile only.
- **File/PDF attachments** — now have two separate actions: click the row
  to open it in a new tab (view), a small download icon to explicitly save
  it. Previously one link only ever forced a download.
- **Lightbox zoom** — wheel, pinch, and double-click zoom now all anchor to
  the actual cursor/pinch/click point instead of always zooming from
  dead-center, and pan is clamped so you can't drag a zoomed image
  completely off-screen.
- **Archive drag gesture reworked** — no longer auto-opens Archived on
  release. A short drag reveals an "Archived" button (with a pop-in
  animation) you have to tap; dragging further and releasing instead
  refreshes the chat list with a spinner animation.
- **Bottom nav** — removed the bouncy overshoot easing on the More sheet,
  moved "More" out of the bottom nav entirely into a small button in the
  top of every panel (Sidebar, Groups, Status, Media, Calls, Broadcast,
  Archived), and replaced the bottom nav's "Groups" tab with "Explore"
  (opens the existing find-people/new-chat search flow).
- **Status viewer** — closes on swipe-down or scroll-down, and the viewer
  list now shows an avatar + name for each viewer (was just a bare
  timestamp before). Server now populates viewer identities.
- **Status compression** — status photos/GIFs now target ~320KB/450KB
  instead of sharing chat media's 1MB target, since status is brief and
  ephemeral.
- **Status preview from Contact Info** — a contact's avatar on their
  Contact Info page is now a clickable ring that opens their current status
  if they have one.
- **Message/conversation caching** — conversations and each chat's recent
  messages persist to localStorage and hydrate instantly on boot, instead
  of showing a blank screen/skeleton until the network call resolves.
  Cleared on logout.
- **System notifications for new messages** — Settings already promised
  this ("new messages can show a system notification") but it was never
  wired up on the receiving side; it now shows a notification (respecting
  per-chat mute, with a decrypted preview) when a message arrives for a
  chat you're not actively looking at. Incoming-call notifications already
  existed.
- **Settings now has real per-section URLs** — `/settings/general`,
  `/settings/account`, `/settings/privacy`, etc., with a mobile back
  button, instead of only living in local component state.

**Already existed (verified, no work needed):**
- Single/double-tick + blue "read" color on messages — fully implemented.
- PWA "update available" banner, install prompt, and iOS add-to-home-screen
  tip — all already built into `PwaManager.jsx`.

**Not done — flagged rather than faked:**
- Status/media **filters** while uploading (Instagram-style color filters) —
  a genuinely new feature, not started.
- **Camera capture** directly in chat and status (live photo/video capture,
  not just file picking) — not started.
- A **"recording audio" indicator** — there's actually no voice-note
  *recording* feature in this codebase at all yet (only playback of
  existing audio attachments), so there's nothing to attach an indicator
  to. Building voice-note recording is a mid-sized feature on its own.
- Deeper UI/UX rework of "modules" beyond what's listed above (this phrase
  was vague in the request — happy to take a specific module if you have
  one in mind).

---

## Round 4 (this update)

**Bugs fixed:**
- **Media & Storage always showed "Unavailable"** — the gallery endpoint
  (`getMediaList`) selected the message's fields for reconstructing the
  decryption key but silently dropped `text`/left it unset while still
  claiming the message had an `iv`; the client's decrypt helper tried to
  decrypt that missing caption *before* returning the actual attachment
  key, so it threw and failed every single item, image or not. Fixed by
  forwarding the caption fields properly, and separately hardened
  `decryptMessageText` so a caption-decrypt failure can never again
  discard an otherwise-valid attachment key.
- **Archived could render on top of another panel** (your first
  screenshot — "Archived" and "Media & Storage" showing stacked together)
  — opening Archived from the More sheet while already on a routed view
  like `/media` left that route's `view` state untouched, so both
  conditions were true at once. Replaced the two independent conditions
  with a single derived `activePanel`, so only one can ever render,
  structurally.

**Archive drag gesture reworked to match your exact description:**
Dragging down from the top of the chat list now reveals an "Archived"
pill that **stays pinned** above the list after you let go (it doesn't
snap back) — tapping it opens Archived. While it's pinned, dragging the
list back up from the top far enough collapses it again. This replaces
last round's version, which snapped back on release and used a second
"drag further to refresh" gesture instead — you didn't ask for that this
time, so I dropped it to match this description exactly.

**Not yet done from this message** (queued for next round):
- Matching the reference-image patterns for the "+" new-chat menu
  (New group/Channels/Broadcasts/Linked devices/Settings dropdown) and the
  Status tab's camera+edit floating buttons.
- A mobile long-press bottom sheet for chat list items (Pin/Archive/Add to
  folder/View info/Delete), matching the reference screenshot.
- Chat header "More" menu additions seen in the reference (in-chat
  "Search", "Story alerts on" toggle).
- I can't currently view/play the uploaded `.mp4` directly — I worked from
  your detailed written description of the Telegram behavior instead. If
  what I built doesn't match what the video shows, tell me where it
  differs and I'll adjust.



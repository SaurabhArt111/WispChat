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

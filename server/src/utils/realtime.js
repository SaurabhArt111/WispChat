// Small helpers for pushing live updates to connected clients.
//
// Every socket joins `user:<id>` (all of that person's tabs/devices) and
// `explore` (everyone, used for public post updates). Controllers call
// these helpers *after* the database write succeeds so clients never see
// an event for something that didn't persist.

export function emitToUsers(io, userIds, event, payload) {
  if (!io) return;
  const seen = new Set();
  for (const id of userIds || []) {
    const key = String(id?._id || id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    io.to(`user:${key}`).emit(event, payload);
  }
}

// The person plus everyone in their contact list.
export function audienceOf(user) {
  return [user._id, ...(user.contacts || [])];
}

// Public post changes go to everyone connected (Explore is public).
export function emitExplore(io, event, payload) {
  io?.to("explore").emit(event, payload);
}

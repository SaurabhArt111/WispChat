// Opens a post at /post/:id. `queue` is the list of posts that follow it in
// whatever the person was browsing (Explore grid, someone's profile), so the
// viewer can keep scrolling through them and then suggest more.
export function openPostRoute(navigate, location, post, queue = []) {
  const from = `${location.pathname}${location.search}`;
  try {
    sessionStorage.setItem("wisp-return-path", from);
  } catch {
    /* private mode */
  }
  // Only keep light copies in history state.
  const light = (p) => ({ ...p, comments: p.comments });
  navigate(`/post/${post._id}`, { state: { post: light(post), from, queue: queue.slice(0, 30).map(light) } });
}

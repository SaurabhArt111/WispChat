import client from "./client";

// Thin wrappers around /api/posts so components don't repeat URL strings.
export const MAX_POSTS_PER_USER = 6;

export const fetchExploreFeed = (limit = 60) =>
  client.get("/posts/feed", { params: { limit } }).then((r) => r.data.posts);

export const fetchUserPosts = (userId) =>
  client.get(`/posts/user/${userId}`).then((r) => r.data.posts);

export const createPost = (file, caption = "", onUploadProgress) => {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("caption", caption);
  return client
    .post("/posts", fd, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: onUploadProgress
        ? (e) => onUploadProgress(e.total ? e.loaded / e.total : 0)
        : undefined,
    })
    .then((r) => r.data.post);
};

export const deletePost = (id) => client.delete(`/posts/${id}`).then((r) => r.data);
export const togglePostLike = (id) => client.post(`/posts/${id}/like`).then((r) => r.data);
export const addPostComment = (id, text) =>
  client.post(`/posts/${id}/comment`, { text }).then((r) => r.data);
export const deletePostComment = (id, commentId) =>
  client.delete(`/posts/${id}/comment/${commentId}`).then((r) => r.data);

// Edit a post: pass `caption` and/or a replacement `file`.
export const updatePost = (id, { caption, file } = {}, onUploadProgress) => {
  const fd = new FormData();
  if (typeof caption === "string") fd.append("caption", caption);
  if (file) fd.append("file", file);
  return client
    .patch(`/posts/${id}`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: onUploadProgress
        ? (e) => onUploadProgress(e.total ? e.loaded / e.total : 0)
        : undefined,
    })
    .then((r) => r.data.post);
};

export const updatePostComment = (id, commentId, text) =>
  client.patch(`/posts/${id}/comment/${commentId}`, { text }).then((r) => r.data.comment);

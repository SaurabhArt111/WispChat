import { createContext, useContext } from "react";

// Lets any attachment open the media viewer on the WHOLE chat's photos/videos
// (so you can swipe through everything, like WhatsApp), without every message
// bubble subscribing to the message list. `getGallery()` is stable and reads
// the latest messages only when called (on tap).
const GalleryContext = createContext(null);

export const GalleryProvider = GalleryContext.Provider;

export function useGallery() {
  return useContext(GalleryContext);
}

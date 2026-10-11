import { forwardRef, useEffect, useState } from "react";
import { ImageIcon, VideoIcon, AlertIcon } from "./Icons";

export function SafeImage({ src, alt, className = "", onClick, onContextMenu, ...rest }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <div className={`media-broken ${className}`} onContextMenu={onContextMenu}>
        <AlertIcon size={18} />
        <span>File unavailable</span>
      </div>
    );
  }

  return (
    <img
      data-no-fallback
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}

export const SafeVideo = forwardRef(function SafeVideo({ src, className = "", onContextMenu, ...rest }, ref) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <div className={`media-broken ${className}`} onContextMenu={onContextMenu}>
        <AlertIcon size={18} />
        <span>File unavailable</span>
      </div>
    );
  }

  return (
    <video
      data-no-fallback
      ref={ref}
      src={src}
      className={className}
      onContextMenu={onContextMenu}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
});

export function SafeAudio({ src, className = "", ...rest }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <div className={`media-broken ${className}`}>
        <AlertIcon size={18} />
        <span>Audio unavailable</span>
      </div>
    );
  }

  return <audio data-no-fallback src={src} className={className} onError={() => setFailed(true)} {...rest} />;
}

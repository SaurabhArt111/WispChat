import { forwardRef, useEffect, useState } from "react";
import { AlertIcon } from "./Icons";

export function MediaUnavailable({ className = "", onContextMenu }) {
  return (
    <div className={`media-broken ${className}`} onContextMenu={onContextMenu}>
      <AlertIcon size={18} />
      <span>Media not found</span>
    </div>
  );
}

export function SafeImage({ src, alt, className = "", onClick, onContextMenu, ...rest }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return <MediaUnavailable className={className} onContextMenu={onContextMenu} />;
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
    return <MediaUnavailable className={className} onContextMenu={onContextMenu} />;
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
    return <MediaUnavailable className={className} />;
  }

  return <audio data-no-fallback src={src} className={className} onError={() => setFailed(true)} {...rest} />;
}

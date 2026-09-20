import { useState } from "react";
import { ImageIcon, VideoIcon, AlertIcon } from "./Icons";

export function SafeImage({ src, alt, className = "", onClick, onContextMenu, ...rest }) {
  const [failed, setFailed] = useState(false);

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

export function SafeVideo({ src, className = "", onContextMenu, ...rest }) {
  const [failed, setFailed] = useState(false);

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
      src={src}
      className={className}
      onContextMenu={onContextMenu}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}

import React, { useState } from "react";

function getFallbackGradient(color) {
  if (!color) return "linear-gradient(135deg, #3ddba7 0%, #15803d 100%)";
  return `linear-gradient(135deg, ${color} 0%, rgba(13, 16, 19, 0.8) 140%)`;
}

export default function Avatar({ user, size = 42, showStatus = false, online = false, className = "" }) {
  const [imgError, setImgError] = useState(false);
  const initials = (user?.displayName || user?.name || "?")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const hasImage = user?.avatar && !imgError;
  const statusSize = Math.max(10, Math.round(size * 0.28));

  return (
    <span
      className={`avatar ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: hasImage ? "var(--surface-3)" : getFallbackGradient(user?.avatarColor),
        color: "#ffffff",
      }}
    >
      {hasImage ? (
        <img
          src={user.avatar}
          alt={user.displayName || "Avatar"}
          className="avatar-inner"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <span className="avatar-inner" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
          {initials}
        </span>
      )}
      {showStatus && (
        <span
          className={`avatar-status ${online ? "online" : ""}`}
          style={{ width: statusSize, height: statusSize }}
          title={online ? "Online" : "Offline"}
        />
      )}
    </span>
  );
}

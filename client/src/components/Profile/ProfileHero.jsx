import { useState } from "react";
import Avatar from "../common/Avatar";
import { BackIcon, CloseIcon } from "../common/Icons";
import "../../styles/profileHero.css";

// Absolutely-positioned header for a `.ci-collapse` container. Its height,
// and the fade between the big avatar / name and the compact toolbar, are all
// derived in CSS from the --p variable that useCollapsingHero maintains.
export default function ProfileHero({
  person,
  title,
  subtitle,
  detail,
  onBack,
  onClose,
  right,
  onAvatarClick,
  avatarHint,
}) {
  const [imgError, setImgError] = useState(false);
  const hasImage = person?.avatar && !imgError;
  const letter = (title || person?.displayName || "?").trim().charAt(0).toUpperCase() || "?";
  const color = person?.avatarColor || "#3ddba7";

  return (
    <div className="ci-hero">
      <div
        className="ci-hero-bg"
        style={hasImage ? undefined : { background: `radial-gradient(120% 90% at 30% 25%, ${color} 0%, ${color} 45%, rgba(13,16,19,.85) 130%)` }}
      >
        {hasImage ? (
          <img src={person.avatar} alt="" onError={() => setImgError(true)} />
        ) : (
          <span className="ci-hero-letter">{letter}</span>
        )}
      </div>
      <div className="ci-hero-shade" />
      <div className="ci-hero-solid" />

      {onAvatarClick && (
        <button type="button" className="ci-hero-hit" onClick={onAvatarClick} aria-label={avatarHint || "View"}>
          {avatarHint && <span className="ci-hero-chip">{avatarHint}</span>}
        </button>
      )}

      <div className="ci-hero-name">
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
        {detail && <span className="ci-hero-detail">{detail}</span>}
      </div>

      <div className="ci-hero-bar">
        {onBack && (
          <button className="ci-hero-btn ci-hero-back" onClick={onBack} title="Back">
            <BackIcon size={20} />
          </button>
        )}
        <div className="ci-hero-mini">
          <Avatar user={person} size={32} />
          <strong>{title}</strong>
        </div>
        {right}
        {onClose && (
          <button className="ci-hero-btn ci-hero-close" onClick={onClose} title="Close">
            <CloseIcon size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

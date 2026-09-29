import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import client from "../../api/client";
import { useToast } from "../../context/ToastContext";
import ProfileHero from "./ProfileHero";
import PostsGrid from "../Posts/PostsGrid";
import useCollapsingHero from "../../hooks/useCollapsingHero";
import useSheetClose from "../../hooks/useSheetClose";
import { EditIcon, LockIcon, SendIcon, UserPlusIcon } from "../common/Icons";
import "../../styles/newChat.css";

// A person's profile (someone who may not be a contact yet): collapsing
// hero, bio, an Add-contact / Message action, and their posts.
export default function ProfileView({
  person,
  isContact = false,
  isOwn = false,
  requestPending = false,
  onMessage,
  onEditProfile,
  onClose,
}) {
  const { showToast } = useToast();
  const [sent, setSent] = useState(requestPending);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const { closing, requestClose } = useSheetClose(onClose);
  useCollapsingHero(panelRef, scrollRef);

  async function addContact() {
    setBusy(true);
    try {
      await client.post("/users/friend-requests", { userId: person._id });
      setSent(true);
      showToast("Request sent", "success");
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't send request", "danger");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className={`profile-overlay ${closing ? "closing" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="profile-page ci-collapse" ref={panelRef}>
        <ProfileHero
          person={person}
          title={person.displayName}
          subtitle={person.username ? `@${person.username}` : ""}
          detail={person.reason || ""}
          onBack={requestClose}
          onClose={requestClose}
        />
        <div className="profile-scroll" ref={scrollRef}>
          <div className="ci-hero-spacer" />

          <div className="ci-call-row">
            {isOwn ? (
              <button className="ci-call-tile" onClick={onEditProfile}>
                <EditIcon size={19} />
                <span>Profile settings</span>
              </button>
            ) : isContact && onMessage ? (
              <button className="ci-call-tile" onClick={onMessage}>
                <SendIcon size={19} />
                <span>Message</span>
              </button>
            ) : (
              <button className="ci-call-tile" onClick={addContact} disabled={busy || sent}>
                <UserPlusIcon size={19} />
                <span>{sent ? "Request sent" : "Add contact"}</span>
              </button>
            )}
          </div>

          {person.about && (
            <div className="ci-card">
              <span className="ci-card-label">About</span>
              <p className="ci-card-text">{person.about}</p>
            </div>
          )}
          <div className="ci-card">
            <span className="ci-card-label">Username</span>
            <p className="ci-card-text">@{person.username}</p>
          </div>

          <div className="profile-section">
            <h3>Posts</h3>
            <PostsGrid userId={person._id} editable={isOwn} />
          </div>

          <p className="ci-e2ee-note">
            <LockIcon size={12} /> Chats on Wisp are end-to-end encrypted
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}

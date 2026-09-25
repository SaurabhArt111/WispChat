import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useCall } from "../../context/CallContext";
import { useContextMenu } from "../../context/ContextMenuContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import LiquidGlassPanel from "../common/LiquidGlassPanel";
import ConfirmModal from "../common/ConfirmModal";
import { formatLastSeen } from "../../utils/time";
import client from "../../api/client";
import TypingDots from "./TypingDots";
import {
  BackIcon,
  SearchIcon,
  InfoIcon,
  MoreIcon,
  MuteIcon,
  PinIcon,
  CloseIcon,
  LockIcon,
  PhoneIcon,
  VideoIcon,
} from "../common/Icons";
import "../../styles/e2ee.css";

export default function ChatHeader({
  conversation,
  onToggleSearch,
  isSearching,
  searchQuery,
  onSearchChange,
  onOpenInfo,
  infoOpen,
}) {
  const { user } = useAuth();
  const { presence, typing, upsertConversation, closeActiveChat } = useChat();
  const { call: activeCall, startCall } = useCall();
  const { openMenu } = useContextMenu();
  const { showToast } = useToast();
  const [confirmAction, setConfirmAction] = useState(null); // 'leave' | 'block' | null

  const other = !conversation.isGroup
    ? conversation.participants?.find((p) => p._id !== user._id)
    : null;

  const canEncrypt = (conversation.participants || []).every((p) => !!p?.e2ee?.publicKeyJwk) && !!user?.e2ee?.publicKeyJwk;

  const label = conversation.isGroup ? conversation.name : other?.displayName || "Unknown";
  const avatarUser = conversation.isGroup
    ? { displayName: conversation.name, avatar: conversation.avatar, avatarColor: "#64748b" }
    : other;

  const isOnline = other ? presence[other._id]?.isOnline ?? other.isOnline : false;
  const lastSeen = other ? presence[other._id]?.lastSeen ?? other.lastSeen : null;

  const typingUsers = Object.values(typing[conversation._id] || {});
  const subtitle = conversation.isGroup
    ? typingUsers.length
      ? `${typingUsers.join(", ")} is typing`
      : `${conversation.participants?.length || 0} members`
    : typingUsers.length
    ? "typing"
    : formatLastSeen(lastSeen, isOnline);

  async function flag(name) {
    try {
      const res = await client.post(`/conversations/${conversation._id}/flag`, { flag: name });
      const key = { mute: "muted", pin: "pinned", archive: "archived" }[name];
      upsertConversation({ ...conversation, [key]: res.data[name + "d"] });
      showToast(`Chat ${res.data[name + "d"] ? name + "d" : "un" + name + "d"}`);
    } catch (err) {
      showToast("Action failed", "danger");
    }
  }

  async function handleLeaveGroup() {
    setConfirmAction(null);
    try {
      await client.post(`/conversations/group/${conversation._id}/leave`);
      showToast("You left the group");
      closeActiveChat();
    } catch {
      showToast("Could not leave group", "danger");
    }
  }

  async function handleBlockUser() {
    setConfirmAction(null);
    try {
      await client.post(`/users/block/${other._id}`);
      showToast(`Blocked ${other?.displayName || "user"}`);
      closeActiveChat();
    } catch {
      showToast("Could not block contact", "danger");
    }
  }

  function openMenu2(e) {
    const items = conversation.isGroup
      ? [
          {
            label: "Group info",
            icon: <InfoIcon size={15} />,
            onClick: () => onOpenInfo?.(),
          },
          {
            label: conversation.muted ? "Unmute notifications" : "Mute notifications",
            icon: <MuteIcon size={15} />,
            onClick: () => flag("mute"),
          },
          {
            label: conversation.pinned ? "Unpin chat" : "Pin chat",
            icon: <PinIcon size={15} filled={conversation.pinned} />,
            onClick: () => flag("pin"),
          },
          { divider: true },
          {
            label: "Leave group",
            danger: true,
            onClick: () => setConfirmAction("leave"),
          },
        ]
      : [
          {
            label: "Contact info",
            icon: <InfoIcon size={15} />,
            onClick: () => onOpenInfo?.(),
          },
          {
            label: conversation.muted ? "Unmute notifications" : "Mute notifications",
            icon: <MuteIcon size={15} />,
            onClick: () => flag("mute"),
          },
          {
            label: conversation.pinned ? "Unpin chat" : "Pin chat",
            icon: <PinIcon size={15} filled={conversation.pinned} />,
            onClick: () => flag("pin"),
          },
          { divider: true },
          {
            label: "Block user",
            danger: true,
            onClick: () => setConfirmAction("block"),
          },
        ];
    openMenu(e, items, label);
  }

  return (
    <LiquidGlassPanel
      as="header"
      className="chat-header-lg"
      panelClassName="chat-header"
      config={{ blurAmount: 0.3, refraction: 0.35, edgeHighlight: 0.25, saturation: 0.1 }}
    >
      {/* Back button for mobile view */}
      <button
        className="icon-btn chat-header-back"
        onClick={closeActiveChat}
        title="Back to conversations"
      >
        <BackIcon size={20} />
      </button>

      <button
        className="chat-header-identity"
        onClick={() => onOpenInfo?.()}
      >
        <Avatar user={avatarUser} size={42} showStatus={!conversation.isGroup} online={isOnline} />
        <div className="chat-header-text">
          <div className="chat-header-name">{label}</div>
          <div className={`chat-header-sub ${typingUsers.length ? "typing" : ""} ${isOnline && !typingUsers.length ? "online" : ""}`}>
            {typingUsers.length > 0 && <TypingDots />}
            <span>{subtitle}</span>
          </div>
          <div className={`e2ee-badge ${canEncrypt ? "" : "unavailable"}`}>
            <LockIcon size={11} />
            <span>{canEncrypt ? "End-to-end encrypted" : "Not encrypted yet"}</span>
          </div>
        </div>
      </button>

      {isSearching && (
        <div className="in-chat-search">
          <input
            autoFocus
            placeholder="Search messages in chat…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <button className="icon-btn btn-sm" onClick={onToggleSearch} title="Close search">
            <CloseIcon size={15} />
          </button>
        </div>
      )}

      <div className="chat-header-actions">
        {!conversation.isGroup && (
          <>
            <button className="icon-btn" title="Voice call" onClick={() => startCall(conversation, "audio")} disabled={!!activeCall}>
              <PhoneIcon size={19} />
            </button>
            <button className="icon-btn" title="Video call" onClick={() => startCall(conversation, "video")} disabled={!!activeCall}>
              <VideoIcon size={19} />
            </button>
          </>
        )}
        <button
          className={`icon-btn ${isSearching ? "active" : ""}`}
          title="Search in chat"
          onClick={onToggleSearch}
        >
          <SearchIcon size={18} />
        </button>
        <button
          className={`icon-btn ${infoOpen ? "active" : ""}`}
          title={conversation.isGroup ? "Group info" : "Contact info"}
          onClick={() => onOpenInfo?.()}
        >
          <InfoIcon size={18} />
        </button>
        <button className="icon-btn" title="More options" onClick={openMenu2}>
          <MoreIcon size={18} />
        </button>
      </div>

      {confirmAction === "leave" && (
        <ConfirmModal
          title="Leave this group?"
          message={`You'll stop receiving messages from "${conversation.name}" unless someone adds you back.`}
          confirmLabel="Leave group"
          danger
          onConfirm={handleLeaveGroup}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "block" && (
        <ConfirmModal
          title={`Block ${other?.displayName || "this contact"}?`}
          message="They won't be able to message you or see your Status. You can unblock them anytime from Settings → Privacy."
          confirmLabel="Block"
          danger
          onConfirm={handleBlockUser}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </LiquidGlassPanel>
  );
}

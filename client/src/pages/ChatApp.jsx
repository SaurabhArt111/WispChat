import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useChat } from "../context/ChatContext";
import { useStatus } from "../context/StatusContext";
import AsideRail from "../components/Sidebar/AsideRail";
import MobileBottomNav from "../components/Sidebar/MobileBottomNav";
import Sidebar from "../components/Sidebar/Sidebar";
import ArchivedPanel from "../components/Sidebar/ArchivedPanel";
import GroupsPanel from "../components/Sidebar/GroupsPanel";
import StatusPanel from "../components/Sidebar/StatusPanel";
import MediaStoragePanel from "../components/Sidebar/MediaStoragePanel";
import BroadcastPanel from "../components/Sidebar/BroadcastPanel";
import CallsPanel from "../components/Sidebar/CallsPanel";
import ProfileModal from "../components/Sidebar/ProfileModal";
import SettingsModal from "../components/Sidebar/SettingsModal";
import ChatWindow from "../components/Chat/ChatWindow";
import ConnectionBanner from "../components/common/ConnectionBanner";
import NewChatModal from "../components/Sidebar/NewChatModal";
import NewGroupModal from "../components/Sidebar/NewGroupModal";
import ContactInfoPanel from "../components/Chat/ContactInfoPanel";
import { SparklesIcon, PlusIcon, UsersIcon } from "../components/common/Icons";
import "../styles/layout.css";

// Views that get their own URL. "chats" (the default sidebar + chat window)
// covers both "/" and "/chat/:id", and isn't listed here since it's the
// fallback for any path that doesn't match one of these. "Archived" is
// deliberately left out — it stays a local panel toggle rather than a
// route, reached only from the link inside the chat list itself.
const ROUTED_VIEWS = ["groups", "status", "media", "calls", "broadcast"];

export default function ChatApp() {
  const { activeId, activeConversation } = useChat();
  const { hasUnread } = useStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const settingsReturnRef = useRef("/");

  const routeSegment = location.pathname.split("/")[1] || "";
  const view = ROUTED_VIEWS.includes(routeSegment) ? routeSegment : "chats";
  const showSettings = location.pathname === "/settings";

  function changeView(id) {
    if (id === "archived") {
      setShowArchived(true);
      return;
    }
    setShowArchived(false);
    navigate(id === "chats" ? "/" : `/${id}`);
  }

  function openSettings() {
    if (!showSettings) settingsReturnRef.current = location.pathname;
    navigate("/settings");
  }

  function closeSettings() {
    navigate(settingsReturnRef.current || "/");
  }

  useEffect(() => {
    setShowContactInfo(false);
  }, [activeId]);

  return (
    <div className={`app-shell ${activeId ? "has-active-chat" : ""} ${showContactInfo ? "has-contact-info" : ""}`}>
      <ConnectionBanner />
      <AsideRail
        view={showArchived ? "archived" : view}
        onChangeView={changeView}
        onOpenProfile={() => setShowProfile(true)}
        onOpenSettings={openSettings}
        hasUnreadStatus={hasUnread}
      />

      {view === "chats" && !showArchived && (
        <Sidebar
          onOpenNewChat={() => setShowNewChat(true)}
          onOpenNewGroup={() => setShowNewGroup(true)}
          onOpenArchived={() => setShowArchived(true)}
        />
      )}
      {showArchived && <ArchivedPanel onBack={() => setShowArchived(false)} />}
      {view === "groups" && <GroupsPanel />}
      {view === "status" && <StatusPanel />}
      {view === "media" && <MediaStoragePanel />}
      {view === "calls" && <CallsPanel />}
      {view === "broadcast" && <BroadcastPanel />}

      <div className="app-main">
        {activeId ? (
          <ChatWindow
            key={activeId}
            onOpenContactInfo={() => setShowContactInfo((open) => !open)}
            contactInfoOpen={showContactInfo}
          />
        ) : (
          <div className="welcome-screen">
            <div className="welcome-logo-badge">
              <SparklesIcon size={38} />
            </div>
            <h2 className="welcome-title">Welcome to Wisp Chat</h2>
            <p className="welcome-tagline">
              Fast, quiet, real-time messaging with instant file sharing, pre-send drawing tools, and rich reactions.
            </p>
            <div className="welcome-actions">
              <button className="btn btn-primary" onClick={() => setShowNewChat(true)}>
                <PlusIcon size={16} /> Start a conversation
              </button>
              <button className="btn btn-ghost" onClick={() => setShowNewGroup(true)}>
                <UsersIcon size={16} /> Create group
              </button>
            </div>
            <div className="welcome-shortcuts">
              <div className="shortcut-item">
                <span className="shortcut-key">Ctrl + F</span>
                <span>Find a chat</span>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-key">Ctrl + V</span>
                <span>Paste files/images</span>
              </div>
              <div className="shortcut-item">
                <span className="shortcut-key">Esc</span>
                <span>Cancel / Close</span>
              </div>
            </div>
            <span className="welcome-footer-tag">🔒 End-to-end socket transport</span>
          </div>
        )}
      </div>
      {showContactInfo && activeConversation && (
        <ContactInfoPanel conversation={activeConversation} onClose={() => setShowContactInfo(false)} />
      )}

      <MobileBottomNav
        view={showArchived ? "archived" : view}
        onChangeView={changeView}
        onOpenSettings={openSettings}
        hasUnreadStatus={hasUnread}
      />

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
      {showNewGroup && <NewGroupModal onClose={() => setShowNewGroup(false)} />}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showSettings && (
        <SettingsModal
          onClose={closeSettings}
          onOpenProfile={() => {
            closeSettings();
            setShowProfile(true);
          }}
        />
      )}
    </div>
  );
}

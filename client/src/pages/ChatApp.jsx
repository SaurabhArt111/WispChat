import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useStatus } from "../context/StatusContext";
import AsideRail from "../components/Sidebar/AsideRail";
import MobileBottomNav from "../components/Sidebar/MobileBottomNav";
import ExplorerPanel from "../components/Sidebar/ExplorerPanel";
import MoreMenuSheet from "../components/Sidebar/MoreMenuSheet";
import Sidebar from "../components/Sidebar/Sidebar";
import ArchivedPanel from "../components/Sidebar/ArchivedPanel";
import GroupsPanel from "../components/Sidebar/GroupsPanel";
import StatusPanel from "../components/Sidebar/StatusPanel";
import MediaStoragePanel from "../components/Sidebar/MediaStoragePanel";
import BroadcastPanel from "../components/Sidebar/BroadcastPanel";
import CallsPanel from "../components/Sidebar/CallsPanel";
import MyProfilePage from "../components/Profile/MyProfilePage";
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
const ROUTED_VIEWS = ["groups", "status", "media", "calls", "broadcast", "explore", "profile"];

export default function ChatApp() {
  const { user } = useAuth();
  const { activeId, activeConversation, infoRequest } = useChat();
  const { hasUnread } = useStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const settingsReturnRef = useRef("/");

  const routeSegment = location.pathname.split("/")[1] || "";
  const view = ROUTED_VIEWS.includes(routeSegment) ? routeSegment : "chats";
  const isProfilePage = routeSegment === "profile";
  const showSettings = location.pathname === "/settings" || location.pathname.startsWith("/settings/");
  // Single source of truth for which sidebar-column panel is on screen.
  // Deriving it once here (rather than checking `showArchived` and `view`
  // independently at each render site) makes it structurally impossible
  // for two panels to render at once — e.g. opening Archived from the More
  // sheet while already on a routed view like /media used to leave `view`
  // still equal to "media" and `showArchived` true at the same time, so
  // both panels rendered stacked on top of each other.
  const activePanel = showArchived ? "archived" : view;

  function changeView(id) {
    if (id === "archived") {
      setShowArchived(true);
      // Clear whatever routed view we might have been on so it can't
      // still be "active" underneath Archived (see activePanel above).
      if (view !== "chats") navigate("/");
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

  function openProfile() {
    setShowArchived(false);
    setShowContactInfo(false);
    navigate("/profile");
  }

  function openProfileEditor() {
    setShowProfileEditor(true);
  }

  useEffect(() => {
    setShowContactInfo(false);
  }, [activeId]);

  // Long-press → "View info" (see ChatContext.viewConversationInfo). Declared
  // after the reset effect above so that, when the chat switch and the
  // request land in the same commit, opening wins over resetting.
  const handledInfoRef = useRef(0);
  useEffect(() => {
    if (infoRequest.n && infoRequest.n !== handledInfoRef.current && activeId === infoRequest.id) {
      handledInfoRef.current = infoRequest.n;
      setShowContactInfo(true);
    }
  }, [infoRequest, activeId]);

  return (
    <div className={`app-shell ${activeId && !isProfilePage ? "has-active-chat" : ""} ${showContactInfo ? "has-contact-info" : ""} ${isProfilePage ? "is-profile-route" : ""}`}>
      <ConnectionBanner />
      <AsideRail
        view={activePanel}
        onChangeView={changeView}
        onOpenProfile={openProfile}
        onOpenSettings={openSettings}
        hasUnreadStatus={hasUnread}
      />

      {activePanel === "chats" && (
        <Sidebar
          onOpenNewChat={() => setShowNewChat(true)}
          onOpenNewGroup={() => setShowNewGroup(true)}
          onOpenArchived={() => setShowArchived(true)}
          onOpenMore={() => setShowMoreMenu(true)}
          onOpenProfile={openProfile}
        />
      )}
      {activePanel === "archived" && (
        <ArchivedPanel onBack={() => setShowArchived(false)} onOpenMore={() => setShowMoreMenu(true)} />
      )}
      {activePanel === "groups" && <GroupsPanel onOpenMore={() => setShowMoreMenu(true)} />}
      {activePanel === "status" && <StatusPanel onOpenMore={() => setShowMoreMenu(true)} />}
      {activePanel === "media" && <MediaStoragePanel onOpenMore={() => setShowMoreMenu(true)} />}
      {activePanel === "calls" && <CallsPanel onOpenMore={() => setShowMoreMenu(true)} />}
      {activePanel === "explore" && <ExplorerPanel onOpenMore={() => setShowMoreMenu(true)} />}
      {activePanel === "broadcast" && <BroadcastPanel onOpenMore={() => setShowMoreMenu(true)} />}

      <div className="app-main">
        {isProfilePage ? (
          <MyProfilePage
            user={user}
            onEditProfile={openProfileEditor}
            onOpenSettings={openSettings}
          />
        ) : activeId ? (
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
        view={activePanel}
        onChangeView={changeView}
        hasUnreadStatus={hasUnread}
      />

      <MoreMenuSheet
        open={showMoreMenu}
        onClose={() => setShowMoreMenu(false)}
        onChangeView={changeView}
        onOpenSettings={openSettings}
      />

      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onOpenNewGroup={() => setShowNewGroup(true)}
        />
      )}
      {showNewGroup && <NewGroupModal onClose={() => setShowNewGroup(false)} />}
      {showProfileEditor && <ProfileModal onClose={() => setShowProfileEditor(false)} />}
      {showSettings && (
        <SettingsModal
          onClose={closeSettings}
          onOpenProfile={() => {
            closeSettings();
            openProfileEditor();
          }}
        />
      )}
    </div>
  );
}

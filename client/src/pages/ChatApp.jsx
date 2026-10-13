import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useStatus } from "../context/StatusContext";
import AsideRail from "../components/Sidebar/AsideRail";
import MobileBottomNav from "../components/Sidebar/MobileBottomNav";
import ExplorerPanel from "../components/Sidebar/ExplorerPanel";
import Sidebar from "../components/Sidebar/Sidebar";
import ArchivedPanel from "../components/Sidebar/ArchivedPanel";
import GroupsPanel from "../components/Sidebar/GroupsPanel";
import StatusPanel from "../components/Sidebar/StatusPanel";
import MediaStoragePanel from "../components/Sidebar/MediaStoragePanel";
import BroadcastPanel from "../components/Sidebar/BroadcastPanel";
import CallsPanel from "../components/Sidebar/CallsPanel";
import MyProfilePage from "../components/Profile/MyProfilePage";
import PostViewerPage from "../components/Posts/PostViewerPage";
import ProfileModal from "../components/Sidebar/ProfileModal";
import SettingsModal from "../components/Sidebar/SettingsModal";
import ChatWindow from "../components/Chat/ChatWindow";
import ConnectionBanner from "../components/common/ConnectionBanner";
import useMediaQuery from "../hooks/useMediaQuery";
import NewChatModal from "../components/Sidebar/NewChatModal";
import NewGroupModal from "../components/Sidebar/NewGroupModal";
import MobileDrawer from "../components/Sidebar/MobileDrawer";
import useSwipeGestures from "../hooks/useSwipeGestures";
import ContactInfoPanel from "../components/Chat/ContactInfoPanel";
import { SparklesIcon, PlusIcon, UsersIcon } from "../components/common/Icons";
import "../styles/layout.css";

// Views that get their own URL. "chats" (the default sidebar + chat window)
// covers both "/" and "/chat/:id", and isn't listed here since it's the
// fallback for any path that doesn't match one of these. "Archived" is now a
// real route (/archived) so it can be linked to, bookmarked and reached with
// the browser back button.
// Order used when swiping left/right between the main mobile tabs.
const TAB_ORDER = ["chats", "status", "explore", "calls", "profile"];
const ROUTED_VIEWS = ["groups", "status", "media", "calls", "broadcast", "explore", "archived", "profile", "post"];

export default function ChatApp() {
  const { user } = useAuth();
  const { activeId, activeConversation, infoRequest } = useChat();
  const { hasUnread } = useStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [slide, setSlide] = useState(null); // "next" | "prev" while a tab transition plays
  const settingsReturnRef = useRef("/");

  const routeSegment = location.pathname.split("/")[1] || "";
  const isDesktop = useMediaQuery("(min-width: 859px)");
  const isPostPage = routeSegment === "post";
  // A post opens as a modal over where you came from on desktop, and as its
  // own full page on mobile — both on the same /post/:id route.
  const postOverlay = isPostPage && isDesktop;
  const postFullPage = isPostPage && !isDesktop;
  let postOriginSegment = "explore";
  if (isPostPage) {
    let from = location.state?.from;
    if (!from) {
      try {
        from = sessionStorage.getItem("wisp-return-path");
      } catch {
        from = null;
      }
    }
    const seg = (from || "/explore").split("/")[1] || "";
    postOriginSegment = seg === "post" ? "explore" : seg;
  }
  const isProfilePage = routeSegment === "profile" || (postOverlay && postOriginSegment === "profile");
  const effectiveSegment = postOverlay ? postOriginSegment : routeSegment;
  const view = ROUTED_VIEWS.includes(effectiveSegment) && effectiveSegment !== "post" ? effectiveSegment : postFullPage ? "post" : "chats";
  const showSettings = location.pathname === "/settings" || location.pathname.startsWith("/settings/");
  // Single source of truth for which sidebar-column panel is on screen —
  // derived purely from the URL, so two panels can never render at once.
  const activePanel = view;

  // Direction of the last tab change → drives the slide animation.
  const prevPanelRef = useRef(activePanel);
  useEffect(() => {
    const from = TAB_ORDER.indexOf(prevPanelRef.current);
    const to = TAB_ORDER.indexOf(activePanel);
    prevPanelRef.current = activePanel;
    if (from < 0 || to < 0 || from === to) return undefined;
    setSlide(to > from ? "next" : "prev");
    const t = setTimeout(() => setSlide(null), 340);
    return () => clearTimeout(t);
  }, [activePanel]);
  useEffect(() => setDrawerOpen(false), [activePanel, activeId]);

  const anyModalOpen = showNewChat || showNewGroup || showProfileEditor || showContactInfo || showSettings;
  useSwipeGestures({
    enabled: !isDesktop && !anyModalOpen && !drawerOpen && !postFullPage,
    onSwipe: ({ dir, startX, width }) => {
      const inChat = !!activeId && activePanel === "chats";
      if (inChat) {
        // In a chat: swipe right → leave the chat; swipe left → open the side drawer.
        if (dir === "right" && startX < width * 0.5) navigate("/");
        else if (dir === "left" && startX > width * 0.5) setDrawerOpen(true);
        return;
      }
      const i = TAB_ORDER.indexOf(activePanel);
      if (i < 0) return;
      const j = dir === "left" ? i + 1 : i - 1;
      if (j < 0 || j >= TAB_ORDER.length) return;
      try { navigator.vibrate?.(6); } catch { /* ignore */ }
      changeView(TAB_ORDER[j]);
    },
  });

  function changeView(id) {
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
    <div data-slide={slide || undefined} className={`app-shell ${activeId && !isProfilePage && !isPostPage ? "has-active-chat" : ""} ${showContactInfo ? "has-contact-info" : ""} ${isProfilePage ? "is-profile-route" : ""} ${postFullPage ? "is-post-route" : ""}`}>
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
          onOpenArchived={() => navigate("/archived")}
          onOpenSettings={openSettings}
          onOpenProfile={openProfile}
        />
      )}
      {activePanel === "archived" && (
        <ArchivedPanel onBack={() => navigate("/")} onOpenSettings={openSettings} />
      )}
      {activePanel === "groups" && <GroupsPanel onOpenSettings={openSettings} />}
      {activePanel === "status" && <StatusPanel onOpenSettings={openSettings} />}
      {activePanel === "media" && <MediaStoragePanel onOpenSettings={openSettings} />}
      {activePanel === "calls" && <CallsPanel onOpenSettings={openSettings} />}
      {activePanel === "explore" && <ExplorerPanel onOpenSettings={openSettings} />}
      {activePanel === "broadcast" && <BroadcastPanel onOpenSettings={openSettings} />}

      <div className="app-main">
        {postFullPage ? (
          <PostViewerPage />
        ) : isProfilePage ? (
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
      {postOverlay && <PostViewerPage />}
      {showContactInfo && activeConversation && (
        <ContactInfoPanel conversation={activeConversation} onClose={() => setShowContactInfo(false)} />
      )}

      {!isDesktop && (
        <MobileDrawer
          open={drawerOpen && !!activeId}
          onClose={() => setDrawerOpen(false)}
          view={activePanel}
          onChangeView={changeView}
          onOpenProfile={openProfile}
          onOpenSettings={openSettings}
        />
      )}

      <MobileBottomNav
        view={activePanel}
        onChangeView={changeView}
        hasUnreadStatus={hasUnread}
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

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
import useNativeApp from "../native/useNativeApp";
import useWarmup from "../hooks/useWarmup";
import NewChatModal from "../components/Sidebar/NewChatModal";
import NewGroupModal from "../components/Sidebar/NewGroupModal";
import MobileDrawer from "../components/Sidebar/MobileDrawer";
import useSwipeGestures from "../hooks/useSwipeGestures";
import useSwipeBack from "../hooks/useSwipeBack";
import useTabSwipe from "../hooks/useTabSwipe";
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
// Tabs that are plain side panels can be shown side-by-side while swiping;
// Profile is a full page, so it just switches.
const PEEKABLE = ["chats", "status", "explore", "calls"];
const ROUTED_VIEWS = ["groups", "status", "media", "calls", "broadcast", "explore", "archived", "profile", "post"];

export default function ChatApp() {
  const { user } = useAuth();
  const { activeId, activeConversation, infoRequest } = useChat();
  const { hasUnread } = useStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [peek, setPeek] = useState(null); // { id, side } neighbour tab rendered next to the current one while dragging
  const suppressSlideRef = useRef(false);
  const [slide, setSlide] = useState(null); // "next" | "prev" while a tab transition plays
  const settingsReturnRef = useRef("/");
  const shellRef = useRef(null);
  useWarmup(); // get recent chats + their photos ready while idle → no blank/flicker on open
  useNativeApp(); // Android shell: push, folder, back button, call accept (no-op in a browser)

  // Contact / group info is a real route (/chat/:id/info) so Back closes it —
  // optionally with a selection on top (/chat/:id/info/selected).
  const showContactInfo = !!activeId && /^\/chat\/[^/]+\/info(\/selected)?\/?$/.test(location.pathname);
  function openContactInfo() {
    if (activeId) navigate(`/chat/${activeId}/info`, { state: { viaInfo: true } });
  }
  function closeContactInfo() {
    if (!activeId) return;
    if (location.state?.viaInfo) navigate(-1);
    else navigate(`/chat/${activeId}`, { replace: true });
  }

  const rawSegment = location.pathname.split("/")[1] || "";
  // /new and /new/call are routes (shareable, back-button friendly). The page
  // that opened them stays rendered underneath, so work out which one.
  const newMatch = location.pathname.match(/^\/new(?:\/(call))?\/?$/);
  const showNewChat = !!newMatch;
  const newMode = newMatch?.[1] === "call" ? "call" : "chat";
  let routeSegment = rawSegment;
  if (rawSegment === "new") {
    const fromSeg = (location.state?.from || "/").split("/")[1] || "";
    routeSegment = ROUTED_VIEWS.includes(fromSeg) && fromSeg !== "post" ? fromSeg : "";
  }
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
    // A live swipe already animated the move — don't play the slide again.
    if (suppressSlideRef.current) {
      suppressSlideRef.current = false;
      return undefined;
    }
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
        // In a chat: swipe left → open the side drawer. (Dragging right to leave
        // the chat is handled live by useSwipeBack below.)
        if (dir === "left" && startX > width * 0.5) setDrawerOpen(true);
        return;
      }
    },
  });

  useTabSwipe({
    enabled: !isDesktop && !anyModalOpen && !drawerOpen && !postFullPage && !(activeId && activePanel === "chats"),
    shellRef,
    order: TAB_ORDER,
    current: activePanel,
    canPeek: (id) => PEEKABLE.includes(id),
    onPeek: setPeek,
    onCommit: (id, { live }) => {
      if (live) suppressSlideRef.current = true;
      changeView(id);
    },
  });

  useSwipeBack({
    enabled: !isDesktop && !anyModalOpen && !drawerOpen && !!activeId && activePanel === "chats",
    shellRef,
    onBack: () => navigate("/"),
  });

  function openNewChat(mode = "chat") {
    navigate(mode === "call" ? "/new/call" : "/new", { state: { from: location.pathname } });
  }

  // Closing goes back to wherever it was opened from. If the page already
  // navigated elsewhere (e.g. it just opened a chat), leave that alone.
  function closeNewChat() {
    if (!/^\/new(\/|$)/.test(window.location.pathname)) return;
    const from = location.state?.from;
    navigate(from && !from.startsWith("/new") ? from : "/", { replace: true });
  }

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
    navigate("/profile");
  }

  function openProfileEditor() {
    setShowProfileEditor(true);
  }

  // Long-press → "View info" (see ChatContext.viewConversationInfo). Declared
  // after the reset effect above so that, when the chat switch and the
  // request land in the same commit, opening wins over resetting.
  const handledInfoRef = useRef(0);
  useEffect(() => {
    if (infoRequest.n && infoRequest.n !== handledInfoRef.current && activeId === infoRequest.id) {
      handledInfoRef.current = infoRequest.n;
      openContactInfo();
    }
  }, [infoRequest, activeId]);

  // Tabs you've already opened stay mounted (hidden) on phones, so coming back
  // to them is instant — no skeleton flash, scroll position kept — and a
  // swiped-in page is the SAME instance that was sliding beside you, not a
  // fresh copy that re-loads. (React keeps them by `key`.)
  const visitedRef = useRef(new Set());
  if (!isDesktop && PEEKABLE.includes(activePanel)) visitedRef.current.add(activePanel);
  const slotIds = [activePanel];
  if (peek && !slotIds.includes(peek.id)) slotIds.push(peek.id);
  if (!isDesktop) visitedRef.current.forEach((id) => !slotIds.includes(id) && slotIds.push(id));

  // Tapping a tab slides to it the same way a swipe does.
  const tabAnimRef = useRef(false);
  function changeTab(id) {
    const shell = shellRef.current;
    const from = activePanel;
    const canSlide =
      !isDesktop && shell && id !== from && !tabAnimRef.current && PEEKABLE.includes(id) &&
      (PEEKABLE.includes(from) || from === "profile") && !(activeId && from === "chats");
    if (!canSlide) return changeView(id);
    const dir = TAB_ORDER.indexOf(id) > TAB_ORDER.indexOf(from) ? 1 : -1;
    tabAnimRef.current = true;
    setPeek({ id, side: dir });
    shell.classList.add("tab-dragging");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        shell.classList.add("tab-settling");
        shell.style.setProperty("--tab-dx", `${-dir * (window.innerWidth + 14)}px`);
      })
    );
    setTimeout(() => {
      suppressSlideRef.current = true;
      changeView(id);
      setPeek(null);
      shell.classList.remove("tab-dragging", "tab-settling");
      shell.style.removeProperty("--tab-dx");
      tabAnimRef.current = false;
    }, 290);
  }

  function renderPanel(id) {
    switch (id) {
      case "chats":
        return (
          <Sidebar
            onOpenNewChat={() => openNewChat("chat")}
            onOpenNewGroup={() => setShowNewGroup(true)}
            onOpenArchived={() => navigate("/archived")}
            onOpenSettings={openSettings}
            onOpenProfile={openProfile}
          />
        );
      case "archived":
        return <ArchivedPanel onBack={() => navigate("/")} onOpenSettings={openSettings} />;
      case "groups":
        return <GroupsPanel onOpenSettings={openSettings} />;
      case "status":
        return <StatusPanel onOpenSettings={openSettings} />;
      case "media":
        return <MediaStoragePanel onOpenSettings={openSettings} />;
      case "calls":
        return <CallsPanel onOpenSettings={openSettings} onOpenNewCall={() => openNewChat("call")} />;
      case "explore":
        return <ExplorerPanel onOpenSettings={openSettings} />;
      case "broadcast":
        return <BroadcastPanel onOpenSettings={openSettings} />;
      default:
        return null;
    }
  }

  return (
    <div ref={shellRef} data-slide={slide || undefined} className={`app-shell ${activeId && !isProfilePage && !isPostPage ? "has-active-chat" : ""} ${showContactInfo ? "has-contact-info" : ""} ${isProfilePage ? "is-profile-route" : ""} ${postFullPage ? "is-post-route" : ""}`}>
      <ConnectionBanner />
      <AsideRail
        view={activePanel}
        onChangeView={changeTab}
        onOpenProfile={openProfile}
        onOpenSettings={openSettings}
        hasUnreadStatus={hasUnread}
      />

      {slotIds.map((id) => {
        const content = renderPanel(id);
        if (!content) return null;
        const role = id === activePanel ? "is-active" : peek?.id === id ? "is-peek" : "is-parked";
        return (
          <div key={id} className={`tab-slot ${role}`} style={role === "is-peek" ? { "--peek-side": peek.side } : undefined}>
            {content}
          </div>
        );
      })}

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
            onOpenContactInfo={() => (showContactInfo ? closeContactInfo() : openContactInfo())}
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
              <button className="btn btn-primary" onClick={() => openNewChat("chat")}>
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
        <ContactInfoPanel conversation={activeConversation} onClose={closeContactInfo} />
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
          mode={newMode}
          onClose={closeNewChat}
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

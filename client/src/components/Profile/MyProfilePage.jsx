import { useEffect, useRef, useState } from "react";
import Avatar from "../common/Avatar";
import PostsGrid from "../Posts/PostsGrid";
import { ChevronDownIcon, CopyIcon, GridIcon, SettingsIcon } from "../common/Icons";
import { useToast } from "../../context/ToastContext";
import "../../styles/myProfile.css";

export default function MyProfilePage({ user, onEditProfile, onOpenSettings }) {
  const { showToast } = useToast();
  const [postCount, setPostCount] = useState(null);
  const pageRef = useRef(null);
  const [showTop, setShowTop] = useState(false);

  // Floating "back to top" once you've scrolled a screen down; rAF-throttled.
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return undefined;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setShowTop(el.scrollTop > 480);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  async function copyUsername() {
    try {
      await navigator.clipboard.writeText(`@${user.username}`);
      showToast("Username copied to clipboard");
    } catch {
      showToast("Couldn't copy username", "danger");
    }
  }

  return (
    <main className="my-profile-route">
      <div className="my-profile-page" ref={pageRef}>
        <header className="my-profile-header">
          <div className="my-profile-avatar">
            <Avatar user={user} size={148} />
          </div>

          <div className="my-profile-details">
            <div className="my-profile-identity">
              <h1>{user.displayName}</h1>
              <button className="my-profile-edit" onClick={onEditProfile}>Edit profile</button>
              <button
                className="my-profile-icon-btn"
                onClick={onOpenSettings}
                title="Settings"
                aria-label="Open settings"
              >
                <SettingsIcon size={20} />
              </button>
            </div>

            <div className="my-profile-stats">
              <span><strong>{postCount ?? "—"}</strong> posts</span>
            </div>

            <div className="my-profile-display-name">
              <strong>{user.username}</strong>
              <button className="my-profile-copy" onClick={copyUsername}>
                <CopyIcon size={14} />
                <span>Copy</span>
              </button>
            </div>
            {user.about && <p className="my-profile-bio">{user.about}</p>}

          </div>
        </header>

        <div className="my-profile-tabs" aria-label="Profile content">
          <div className="my-profile-tab active">
            <GridIcon size={16} />
            <span>Posts</span>
          </div>
        </div>

        {postCount === 0 && (
          <div className="my-profile-empty">
            <div className="my-profile-empty-icon"><GridIcon size={24} /></div>
            <h2>Share your first post</h2>
            <p>Your posts will appear here.</p>
          </div>
        )}

        <section className="my-profile-posts" aria-label="Your posts">
          <PostsGrid
            userId={user._id}
            editable
            showLimit={false}
            onCountChange={setPostCount}
          />
        </section>
      </div>
      <button
        type="button"
        className={`my-profile-top ${showTop ? "show" : ""}`}
        onClick={() => pageRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
        tabIndex={showTop ? 0 : -1}
      >
        <ChevronDownIcon size={20} />
      </button>
    </main>
  );
}
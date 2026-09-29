import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Virtuoso } from "react-virtuoso";
import client from "../../api/client";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import ProfileView from "../Profile/ProfileView";
import useSheetClose from "../../hooks/useSheetClose";
import { BackIcon, MegaphoneIcon, SearchIcon, UserPlusIcon, UsersIcon, CloseIcon } from "../common/Icons";
import "../../styles/newChat.css";

// Full "New chat" page (mobile: full screen, rises from the bottom; desktop:
// a centered card). Sections: New group / New broadcast, your contacts,
// people whose posts you liked, and suggestions. Tapping a contact opens the
// chat; tapping anyone else opens their profile (with "Add contact") because
// people can be discovered freely but only chatted with once added.
export default function NewChatPage({ onClose, onOpenNewGroup }) {
  const navigate = useNavigate();
  const { startDirectConversation, openConversation } = useChat();
  const { showToast } = useToast();
  const { closing, requestClose } = useSheetClose(onClose);

  const [contacts, setContacts] = useState(null);
  const [liked, setLiked] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState(null);
  const [profile, setProfile] = useState(null);
  const [requested, setRequested] = useState(() => new Set());
  const inputRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    let active = true;
    Promise.allSettled([client.get("/users/contacts"), client.get("/users/suggestions")]).then(([c, s]) => {
      if (!active) return;
      setContacts(c.status === "fulfilled" ? c.value.data.contacts || [] : []);
      if (s.status === "fulfilled") {
        setLiked(s.value.data.likedAuthors || []);
        setSuggested(s.value.data.suggested || []);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (searching) inputRef.current?.focus();
  }, [searching]);

  // Debounced global search (username / name / email / user ID)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setRemote(null);
      return undefined;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      client
        .get("/users/search", { params: { q } })
        .then((r) => mine === seq.current && setRemote(r.data.users || []))
        .catch(() => mine === seq.current && setRemote([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const contactIds = useMemo(() => new Set((contacts || []).map((c) => String(c._id))), [contacts]);
  const sortedContacts = useMemo(
    () => [...(contacts || [])].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [contacts]
  );

  async function openChat(userId) {
    try {
      const conv = await startDirectConversation(userId);
      await openConversation(conv._id);
      onClose();
    } catch {
      showToast("Could not start conversation", "danger");
    }
  }

  async function quickAdd(person) {
    try {
      await client.post("/users/friend-requests", { userId: person._id });
      setRequested((s) => new Set(s).add(String(person._id)));
      showToast("Request sent", "success");
    } catch (err) {
      showToast(err?.response?.data?.message || "Couldn't send request", "danger");
    }
  }

  function personRow(p, sub, extra = {}) {
    const isContact = extra.isContact ?? contactIds.has(String(p._id));
    const pending = extra.requestPending || requested.has(String(p._id));
    return { type: "person", key: `${extra.section || "p"}-${p._id}`, person: p, sub, isContact, pending };
  }

  const rows = useMemo(() => {
    const out = [];
    const q = query.trim().toLowerCase();

    if (q) {
      const local = sortedContacts.filter(
        (c) => c.displayName.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q)
      );
      if (local.length) {
        out.push({ type: "title", key: "t-contacts", title: "Contacts on Wisp" });
        local.forEach((c) => out.push(personRow(c, `@${c.username}`, { section: "c", isContact: true })));
      }
      const others = (remote || []).filter((u) => !contactIds.has(String(u._id)));
      if (remote === null) out.push({ type: "note", key: "n-searching", text: "Searching…" });
      else if (others.length) {
        out.push({ type: "title", key: "t-more", title: "More people" });
        others.forEach((u) => out.push(personRow(u, `@${u.username}`, { section: "r", isContact: false })));
      } else if (!local.length) out.push({ type: "note", key: "n-none", text: "No one found. Try a @username, name or user ID." });
      return out;
    }

    out.push({ type: "action", key: "a-group", icon: <UsersIcon size={22} />, label: "New group", onClick: () => { onClose(); onOpenNewGroup?.(); } });
    out.push({ type: "action", key: "a-bcast", icon: <MegaphoneIcon size={22} />, label: "New broadcast", onClick: () => { onClose(); navigate("/broadcast"); } });
    out.push({ type: "divider", key: "d1" });

    if (contacts === null) {
      for (let i = 0; i < 7; i++) out.push({ type: "skeleton", key: `sk-${i}` });
      return out;
    }

    if (sortedContacts.length) {
      out.push({ type: "title", key: "t-contacts", title: "Contacts on Wisp" });
      sortedContacts.forEach((c) => out.push(personRow(c, c.about || `@${c.username}`, { section: "c", isContact: true })));
    } else {
      out.push({ type: "note", key: "n-nocontacts", text: "No contacts yet — search for someone or pick from the suggestions below." });
    }

    if (liked.length) {
      out.push({ type: "title", key: "t-liked", title: "From posts you liked" });
      liked.forEach((u) =>
        out.push(personRow(u, `You liked ${u.likedCount} post${u.likedCount > 1 ? "s" : ""}`, { section: "l", isContact: u.isContact, requestPending: u.requestPending }))
      );
    }
    if (suggested.length) {
      out.push({ type: "title", key: "t-sugg", title: "Suggested for you" });
      suggested.forEach((u) => out.push(personRow(u, u.reason, { section: "s", isContact: false })));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, remote, contacts, liked, suggested, sortedContacts, contactIds, requested]);

  function renderRow(index, row) {
    switch (row.type) {
      case "action":
        return (
          <button className="nc-action-row" onClick={row.onClick}>
            <span className="nc-action-icon">{row.icon}</span>
            <span className="nc-action-label">{row.label}</span>
          </button>
        );
      case "divider":
        return <div className="nc-divider" />;
      case "title":
        return <div className="nc-section-title">{row.title}</div>;
      case "note":
        return <div className="nc-empty">{row.text}</div>;
      case "skeleton":
        return (
          <div className="nc-skel-row">
            <span className="skeleton" style={{ width: 46, height: 46, borderRadius: "50%" }} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="skeleton" style={{ width: "48%", height: 13 }} />
              <span className="skeleton" style={{ width: "30%", height: 10 }} />
            </span>
          </div>
        );
      default: {
        const { person, sub, isContact, pending } = row;
        return (
          <div
            className="nc-person"
            role="button"
            tabIndex={0}
            onClick={() => (isContact ? openChat(person._id) : setProfile({ person, isContact, pending }))}
            onKeyDown={(e) => e.key === "Enter" && (isContact ? openChat(person._id) : setProfile({ person, isContact, pending }))}
          >
            <Avatar user={person} size={46} />
            <span className="nc-person-text">
              <span className="nc-person-name">{person.displayName}</span>
              {sub && <span className="nc-person-sub">{sub}</span>}
            </span>
            {!isContact && (
              <button
                className="nc-add-pill"
                disabled={pending}
                onClick={(e) => {
                  e.stopPropagation();
                  quickAdd(person);
                }}
              >
                {pending ? "Requested" : "Add"}
              </button>
            )}
          </div>
        );
      }
    }
  }

  return createPortal(
    <div className={`newchat-overlay ${closing ? "closing" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="newchat-page" role="dialog" aria-label="New chat">
        <div className="newchat-header">
          <button className="icon-btn" onClick={requestClose} title="Back">
            <BackIcon size={20} />
          </button>
          {searching ? (
            <div className="newchat-search">
              <input
                ref={inputRef}
                placeholder="Search by @username, name or user ID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="icon-btn"
                onClick={() => {
                  setQuery("");
                  setSearching(false);
                }}
                title="Close search"
              >
                <CloseIcon size={18} />
              </button>
            </div>
          ) : (
            <>
              <h2 className="newchat-title">New chat</h2>
              <button className="icon-btn" onClick={() => setSearching(true)} title="Search">
                <SearchIcon size={19} />
              </button>
            </>
          )}
        </div>

        <div className="newchat-body">
          <Virtuoso
            style={{ height: "100%" }}
            data={rows}
            computeItemKey={(i, row) => row.key}
            itemContent={renderRow}
            overscan={300}
            components={{ Footer: () => <div style={{ height: 96 }} /> }}
          />
          <button className="nc-fab" title="Find people to add" onClick={() => setSearching(true)}>
            <UserPlusIcon size={24} />
          </button>
        </div>
      </div>

      {profile && (
        <ProfileView
          person={profile.person}
          isContact={profile.isContact}
          requestPending={profile.pending}
          onMessage={() => openChat(profile.person._id)}
          onClose={() => setProfile(null)}
        />
      )}
    </div>,
    document.body
  );
}

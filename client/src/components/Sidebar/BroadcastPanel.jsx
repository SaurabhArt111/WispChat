import { useEffect, useState } from "react";
import client from "../../api/client";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import { MegaphoneIcon, SendIcon, CheckIcon } from "../common/Icons";
import "../../styles/railPanels.css";

/**
 * A "broadcast" here means exactly what the label promises and nothing
 * more: pick contacts, write one message, and it goes out as a normal,
 * separate DM to each of them — there's no shared "broadcast" thread, no
 * group, and recipients can't see who else got it, matching how broadcast
 * lists work in most chat apps.
 */
export default function BroadcastPanel() {
  const { startDirectConversation, sendMessage } = useChat();
  const { showToast } = useToast();
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    client.get("/users/contacts").then((res) => setContacts(res.data.contacts || []));
  }, []);

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSend() {
    if (!text.trim() || selected.size === 0 || sending) return;
    setSending(true);
    let okCount = 0;
    for (const userId of selected) {
      try {
        const conv = await startDirectConversation(userId);
        await sendMessage(conv._id, { text: text.trim() });
        okCount++;
      } catch {
        // continue broadcasting to the rest even if one recipient fails
      }
    }
    setSending(false);
    setSent(true);
    showToast(`Sent to ${okCount} of ${selected.size} contact${selected.size > 1 ? "s" : ""}`);
    setTimeout(() => {
      setSent(false);
      setText("");
      setSelected(new Set());
    }, 1500);
  }

  return (
    <aside className="rail-panel">
      <div className="rail-panel-header">
        <h2>Broadcast Lists</h2>
      </div>

      {contacts.length === 0 ? (
        <div className="rail-panel-empty">
          <MegaphoneIcon size={30} />
          <p>Add some contacts first — broadcasting sends one message to several people at once, each as a normal DM.</p>
        </div>
      ) : (
        <>
          <div className="rail-panel-scroll broadcast-contact-scroll">
            <div className="rail-panel-hint" style={{ padding: "0 4px 10px" }}>
              Pick who gets this message. Each person receives it as a private message — they
              won't see who else got it.
            </div>
            {contacts.map((c) => (
              <button key={c._id} className="broadcast-contact-row" onClick={() => toggle(c._id)}>
                <span className={`broadcast-checkbox ${selected.has(c._id) ? "checked" : ""}`}>
                  {selected.has(c._id) && <CheckIcon size={12} />}
                </span>
                <Avatar user={c} size={36} />
                <span className="broadcast-contact-name">{c.displayName}</span>
              </button>
            ))}
          </div>

          <div className="broadcast-composer">
            <textarea
              placeholder={selected.size ? `Message ${selected.size} contact${selected.size > 1 ? "s" : ""}…` : "Select contacts above first…"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              disabled={selected.size === 0}
            />
            <button
              className="btn btn-primary broadcast-send-btn"
              disabled={!text.trim() || selected.size === 0 || sending}
              onClick={handleSend}
            >
              {sent ? <CheckIcon size={15} /> : <SendIcon size={15} />}
              {sending ? "Sending…" : sent ? "Sent" : "Broadcast"}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

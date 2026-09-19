import { useEffect, useState } from "react";
import client from "../../api/client";
import Avatar from "../common/Avatar";
import Modal from "../common/Modal";
import { useToast } from "../../context/ToastContext";
import { CheckIcon, CloseIcon, BellIcon } from "../common/Icons";

export default function FriendRequestsModal({ onClose, onCountChange }) {
  const [tab, setTab] = useState("incoming");
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const { showToast } = useToast();

  function load() {
    client
      .get("/users/friend-requests")
      .then((res) => {
        setIncoming(res.data.incoming || []);
        setOutgoing(res.data.outgoing || []);
        onCountChange?.(res.data.incoming?.length || 0);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  async function respond(id, accept) {
    setBusyId(id);
    try {
      await client.post(`/users/friend-requests/${id}/respond`, { accept });
      showToast(accept ? "Friend request accepted" : "Request declined");
      load();
    } catch (err) {
      showToast("Action failed", "danger");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="Friend Requests" onClose={onClose}>
      <div className="auth-tabs" style={{ marginBottom: "12px" }}>
        <button
          className={tab === "incoming" ? "active" : ""}
          onClick={() => setTab("incoming")}
        >
          Incoming {incoming.length > 0 && `(${incoming.length})`}
        </button>
        <button
          className={tab === "outgoing" ? "active" : ""}
          onClick={() => setTab("outgoing")}
        >
          Sent {outgoing.length > 0 && `(${outgoing.length})`}
        </button>
      </div>

      {tab === "incoming" && (
        <div className="user-pick-list">
          {incoming.length === 0 && (
            <div className="modal-hint">
              <BellIcon size={28} style={{ opacity: 0.4, margin: "0 auto 8px" }} />
              <p>No incoming friend requests.</p>
            </div>
          )}
          {incoming.map((r) => (
            <div key={r._id} className="user-pick-row">
              <Avatar user={r.from} size={42} showStatus online={r.from.isOnline} />
              <div className="user-pick-info">
                <div className="user-pick-name">{r.from.displayName}</div>
                <div className="user-pick-sub">@{r.from.username}</div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busyId === r._id}
                onClick={() => respond(r._id, false)}
              >
                <CloseIcon size={14} /> Decline
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={busyId === r._id}
                onClick={() => respond(r._id, true)}
              >
                <CheckIcon size={14} /> Accept
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "outgoing" && (
        <div className="user-pick-list">
          {outgoing.length === 0 && <p className="modal-hint">No pending sent requests.</p>}
          {outgoing.map((r) => (
            <div key={r._id} className="user-pick-row">
              <Avatar user={r.to} size={42} showStatus online={r.to.isOnline} />
              <div className="user-pick-info">
                <div className="user-pick-name">{r.to.displayName}</div>
                <div className="user-pick-sub">Pending approval…</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

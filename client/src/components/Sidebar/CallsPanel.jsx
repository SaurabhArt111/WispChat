import { useEffect, useState } from "react";
import client from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useSocket } from "../../context/SocketContext";
import Avatar from "../common/Avatar";
import { PhoneIcon, VideoIcon } from "../common/Icons";
import { formatListTime } from "../../utils/time";
import "../../styles/railPanels.css";

function callLabel(call) {
  const { kind, status, durationSec = 0 } = call.callInfo;
  const label = kind === "video" ? "Video call" : "Voice call";
  if (status === "missed") return `Missed ${label.toLowerCase()}`;
  if (status === "declined") return `${label} declined`;
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  return `${label} · ${minutes > 0 ? `${minutes}m ` : ""}${seconds}s`;
}

export default function CallsPanel() {
  const { user } = useAuth();
  const { openConversation } = useChat();
  const { socket } = useSocket();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadCalls(showLoading = true) {
      if (showLoading) setLoading(true);
      setFailed(false);
      try {
        const res = await client.get("/messages/calls");
        if (active) setCalls(res.data.calls || []);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    }

    function onMessage(message) {
      if (message.callInfo) loadCalls(false);
    }

    loadCalls();
    socket?.on("message:new", onMessage);
    return () => {
      active = false;
      socket?.off("message:new", onMessage);
    };
  }, [socket]);

  return (
    <aside className="rail-panel">
      <div className="rail-panel-header">
        <h2>Calls</h2>
        {!loading && calls.length > 0 && <span className="rail-panel-count">{calls.length}</span>}
      </div>

      {loading ? (
        <div className="rail-panel-empty rail-panel-empty-tall"><p>Loading calls...</p></div>
      ) : failed ? (
        <div className="rail-panel-empty rail-panel-empty-tall"><p>Could not load call history.</p></div>
      ) : calls.length === 0 ? (
        <div className="rail-panel-empty rail-panel-empty-tall">
          <PhoneIcon size={34} />
          <p>Your voice and video calls will appear here.</p>
        </div>
      ) : (
        <div className="rail-panel-list calls-list">
          {calls.map((call) => {
            const conversation = call.conversation;
            const peer = conversation?.isGroup
              ? { displayName: conversation.name, avatar: conversation.avatar, avatarColor: "#64748b" }
              : conversation?.participants?.find((participant) => participant._id !== user?._id) || call.sender;
            const isVideo = call.callInfo.kind === "video";
            const isOutgoing = call.sender?._id === user?._id;

            return (
              <button
                className="call-log-row"
                key={call._id}
                onClick={() => openConversation(conversation?._id)}
                type="button"
              >
                <Avatar user={peer} size={42} />
                <span className="call-log-details">
                  <span className="call-log-name">{peer?.displayName || "Unknown"}</span>
                  <span className={`call-log-summary ${call.callInfo.status === "missed" ? "missed" : ""}`}>
                    {isVideo ? <VideoIcon size={14} /> : <PhoneIcon size={14} />}
                    {isOutgoing ? "Outgoing" : "Incoming"} · {callLabel(call)}
                  </span>
                </span>
                <span className="call-log-time">{formatListTime(call.createdAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

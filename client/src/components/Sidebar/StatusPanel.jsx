import { useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useStatus } from "../../context/StatusContext";
import Avatar from "../common/Avatar";
import StatusEditor from "./StatusEditor";
import StatusViewer from "./StatusViewer";
import { PlusIcon, StatusRingIcon, CameraIcon, TypeIcon } from "../common/Icons";
import { formatListTime } from "../../utils/time";
import "../../styles/railPanels.css";
import "../../styles/status.css";

export default function StatusPanel() {
  const { user } = useAuth();
  const { myEntry, contactEntries, loading } = useStatus();
  const [editorMode, setEditorMode] = useState(null); // null | 'text' | 'file'
  const [pickedFile, setPickedFile] = useState(null);
  const [viewing, setViewing] = useState(null); // entry object to view
  const [showAddMenu, setShowAddMenu] = useState(false);
  const fileInputRef = useRef(null);

  function openFilePicker() {
    setShowAddMenu(false);
    fileInputRef.current?.click();
  }

  function onFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPickedFile(file);
    setEditorMode("file");
  }

  return (
    <aside className="rail-panel">
      <div className="rail-panel-header">
        <h2>Status</h2>
      </div>

      <div className="rail-panel-scroll status-panel-scroll">
        <div className="status-my-row-wrap">
          <button
            className="status-row"
            onClick={() => (myEntry ? setViewing(myEntry) : setShowAddMenu((s) => !s))}
          >
            <span className={`status-ring ${myEntry ? "has-status" : "empty"}`}>
              <Avatar user={user} size={50} />
              {!myEntry && (
                <span className="status-add-badge">
                  <PlusIcon size={12} />
                </span>
              )}
            </span>
            <div className="status-row-text">
              <div className="status-row-name">My Status</div>
              <div className="status-row-sub">
                {myEntry
                  ? `${myEntry.items.length} update${myEntry.items.length > 1 ? "s" : ""} · ${formatListTime(
                      myEntry.items[myEntry.items.length - 1].createdAt
                    )}`
                  : "Tap to add a status update"}
              </div>
            </div>
          </button>

          {showAddMenu && (
            <div className="status-add-menu">
              <button onClick={openFilePicker}>
                <CameraIcon size={16} /> Photo or video
              </button>
              <button
                onClick={() => {
                  setShowAddMenu(false);
                  setEditorMode("text");
                }}
              >
                <TypeIcon size={16} /> Text status
              </button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/*,video/*" hidden onChange={onFileChosen} />
        </div>

        {contactEntries.length > 0 && (
          <>
            <div className="rail-panel-section-title status-recent-title">Recent updates</div>
            <div className="status-list">
              {contactEntries.map((entry) => {
                const allSeen = entry.items.every((i) => i.viewedByMe);
                const latest = entry.items[entry.items.length - 1];
                return (
                  <button className="status-row" key={entry.user._id} onClick={() => setViewing(entry)}>
                    <span className={`status-ring ${allSeen ? "seen" : "unseen"}`}>
                      <Avatar user={entry.user} size={50} />
                    </span>
                    <div className="status-row-text">
                      <div className="status-row-name">{entry.user.displayName}</div>
                      <div className="status-row-sub">{formatListTime(latest.createdAt)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {!loading && contactEntries.length === 0 && (
          <div className="rail-panel-empty">
            <StatusRingIcon size={30} />
            <p>
              When your contacts post updates, they'll show up here. Statuses disappear after 24
              hours, just like the original.
            </p>
          </div>
        )}
      </div>

      {editorMode && (
        <StatusEditor
          mode={editorMode}
          file={pickedFile}
          onClose={() => {
            setEditorMode(null);
            setPickedFile(null);
          }}
        />
      )}

      {viewing && <StatusViewer entry={viewing} isOwn={viewing.user._id === user._id} onClose={() => setViewing(null)} />}
    </aside>
  );
}

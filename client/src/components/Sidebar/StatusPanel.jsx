import { useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useStatus, MAX_STATUSES } from "../../context/StatusContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import StatusEditor from "./StatusEditor";
import StatusViewer from "./StatusViewer";
import MobileMoreButton from "./MobileMoreButton";
import { PlusIcon, StatusRingIcon, CameraIcon, TypeIcon } from "../common/Icons";
import { formatListTime } from "../../utils/time";
import "../../styles/railPanels.css";
import "../../styles/status.css";

export default function StatusPanel({ onOpenMore }) {
  const { user } = useAuth();
  const { myEntry, contactEntries, loading } = useStatus();
  const { showToast } = useToast();
  const [editorMode, setEditorMode] = useState(null); // null | 'text' | 'file'
  const [pickedFile, setPickedFile] = useState(null);
  const [viewing, setViewing] = useState(null); // entry object to view
  const fileInputRef = useRef(null);

  const myCount = myEntry?.items?.length || 0;
  const atLimit = myCount >= MAX_STATUSES;
  const statusSections = [
    {
      title: "Remaining to watch",
      entries: contactEntries.filter((entry) => entry.items.some((item) => !item.viewedByMe)),
      allSeen: false,
    },
    {
      title: "Watched",
      entries: contactEntries.filter((entry) => entry.items.every((item) => item.viewedByMe)),
      allSeen: true,
    },
  ].filter((section) => section.entries.length > 0);

  function guardLimit() {
    if (atLimit) {
      showToast(`You can only have ${MAX_STATUSES} active status updates at once`);
      return true;
    }
    return false;
  }

  function openFilePicker() {
    if (guardLimit()) return;
    fileInputRef.current?.click();
  }

  function openTextEditor() {
    if (guardLimit()) return;
    setEditorMode("text");
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
        {onOpenMore && <MobileMoreButton onClick={onOpenMore} />}
      </div>

      <div className="rail-panel-scroll status-panel-scroll">
        <div className="status-my-row-wrap">
          <button
            className="status-row"
            onClick={() => (myEntry ? setViewing(myEntry) : openFilePicker())}
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
                  ? `${myCount}/${MAX_STATUSES} update${myCount > 1 ? "s" : ""} · ${formatListTime(
                      myEntry.items[myEntry.items.length - 1].createdAt
                    )}`
                  : "Tap to add a status update"}
              </div>
            </div>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*,video/*" hidden onChange={onFileChosen} />
        </div>

        {statusSections.map(({ title, entries, allSeen }) => (
          <section key={title}>
            <div className="rail-panel-section-title status-recent-title">{title}</div>
            <div className="status-list">
              {entries.map((entry) => {
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
          </section>
        ))}

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

      {/* Floating add actions, pinned to the bottom-right of the panel —
          a small "text status" pencil FAB stacked above a larger green
          camera FAB, matching WhatsApp/Telegram. Both are always on
          screen (not tucked behind a menu toggle) so adding a status is a
          single tap, with touch targets sized well past the 44px minimum. */}
      <div className="status-fab-stack">
        <button
          className={`status-fab status-fab-edit ${atLimit ? "disabled" : ""}`}
          title={atLimit ? `Maximum ${MAX_STATUSES} statuses` : "Text status"}
          onClick={openTextEditor}
        >
          <TypeIcon size={19} />
        </button>
        <button
          className={`status-fab status-fab-camera ${atLimit ? "disabled" : ""}`}
          title={atLimit ? `Maximum ${MAX_STATUSES} statuses` : "Photo or video status"}
          onClick={openFilePicker}
        >
          <CameraIcon size={22} />
        </button>
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

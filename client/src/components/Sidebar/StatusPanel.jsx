import { useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { useAuth } from "../../context/AuthContext";
import { useStatus, MAX_STATUSES } from "../../context/StatusContext";
import { useToast } from "../../context/ToastContext";
import Avatar from "../common/Avatar";
import StatusEditor from "./StatusEditor";
import StatusViewer from "./StatusViewer";
import MobileMoreButton from "./MobileMoreButton";
import StatusPrivacyModal from "./StatusPrivacyModal";
import { PlusIcon, StatusRingIcon, CameraIcon, TypeIcon, ShieldIcon } from "../common/Icons";
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
  const [showPrivacy, setShowPrivacy] = useState(false);
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

  const rows = [
    { key: "me", type: "me" },
    ...statusSections.flatMap(({ title, entries, allSeen }) => [
      { key: `t-${title}`, type: "title", title },
      ...entries.map((entry) => ({ key: `e-${title}-${entry.user._id}`, type: "entry", entry, allSeen })),
    ]),
    ...(!loading && contactEntries.length === 0 ? [{ key: "empty", type: "empty" }] : []),
  ];

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
        <div className="explorer-header-actions">
          <button className="icon-btn" title="Status privacy" onClick={() => setShowPrivacy(true)}>
            <ShieldIcon size={18} />
          </button>
          {onOpenMore && <MobileMoreButton onClick={onOpenMore} />}
        </div>
      </div>

      {/* Virtualized: "My Status", the section titles, and every contact's
          row are flattened into one list so only the rows near the
          viewport are mounted, however many contacts have posted. */}
      <Virtuoso
        className="status-panel-scroll"
        style={{ flex: 1, minHeight: 0 }}
        data={rows}
        computeItemKey={(index, row) => row.key}
        overscan={300}
        components={{ Header: () => <div style={{ height: 12 }} />, Footer: () => <div style={{ height: 120 }} /> }}
        itemContent={(index, row) => {
          if (row.type === "me") {
            return (
              <div className="status-row-gutter status-my-row-wrap">
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
            );
          }
          if (row.type === "title") {
            return <div className="status-row-gutter rail-panel-section-title status-recent-title">{row.title}</div>;
          }
          if (row.type === "empty") {
            return (
              <div className="status-row-gutter rail-panel-empty">
                <StatusRingIcon size={30} />
                <p>
                  When your contacts post updates, they'll show up here. Statuses disappear after 24
                  hours, just like the original.
                </p>
              </div>
            );
          }
          const { entry, allSeen } = row;
          const latest = entry.items[entry.items.length - 1];
          return (
            <div className="status-row-gutter">
            <button className="status-row" onClick={() => setViewing(entry)}>
              <span className={`status-ring ${allSeen ? "seen" : "unseen"}`}>
                <Avatar user={entry.user} size={50} />
              </span>
              <div className="status-row-text">
                <div className="status-row-name">{entry.user.displayName}</div>
                <div className="status-row-sub">{formatListTime(latest.createdAt)}</div>
              </div>
            </button>
            </div>
          );
        }}
      />

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

      {showPrivacy && <StatusPrivacyModal onClose={() => setShowPrivacy(false)} />}
      {viewing && <StatusViewer entry={viewing} isOwn={viewing.user._id === user._id} onClose={() => setViewing(null)} />}
    </aside>
  );
}

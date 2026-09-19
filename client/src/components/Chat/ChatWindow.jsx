import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import { uploadFiles } from "../../api/upload";
import ChatHeader from "./ChatHeader";
import MessageList from "./MessageList";
import Composer from "./Composer";
import MediaComposer from "../MediaComposer/MediaComposer";
import { DownloadIcon } from "../common/Icons";
import "../../styles/chat.css";

export default function ChatWindow() {
  const { activeConversation, sendMessage } = useChat();
  const { showToast } = useToast();
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [pendingFiles, setPendingFiles] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dragCounter = useRef(0);

  const openMediaComposer = useCallback((files) => {
    if (!files || files.length === 0) return;
    setPendingFiles(Array.from(files));
  }, []);

  const pendingFilesRef = useRef(pendingFiles);
  pendingFilesRef.current = pendingFiles;

  useEffect(() => {
    function onGlobalPaste(e) {
      if (pendingFilesRef.current) return;
      const clipboardItems = Array.from(e.clipboardData?.items || []);
      const files = clipboardItems
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter(Boolean);
      if (files.length > 0) {
        e.preventDefault();
        openMediaComposer(files);
      }
    }
    document.addEventListener("paste", onGlobalPaste);
    return () => document.removeEventListener("paste", onGlobalPaste);
  }, [openMediaComposer]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) {
      dragCounter.current += 1;
      setDragActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
      if (e.dataTransfer.files?.length) {
        openMediaComposer(e.dataTransfer.files);
      }
    },
    [openMediaComposer]
  );

  if (!activeConversation) return null;

  async function handleSendFromComposer(payload) {
    await sendMessage(activeConversation._id, {
      ...payload,
      replyTo: replyTo?._id,
      replyToMessage: replyTo,
    });
    setReplyTo(null);
  }

  return (
    <div
      className="chat-window"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ChatHeader
        conversation={activeConversation}
        isSearching={isSearching}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onToggleSearch={() => {
          setIsSearching((s) => !s);
          setSearchQuery("");
        }}
      />
      <MessageList
        conversation={activeConversation}
        onReply={setReplyTo}
        onEdit={setEditingMessage}
        searchQuery={isSearching ? searchQuery : ""}
      />
      <Composer
        conversation={activeConversation}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        editingMessage={editingMessage}
        onCancelEdit={() => setEditingMessage(null)}
        onSend={handleSendFromComposer}
        onAttachFiles={openMediaComposer}
      />

      {dragActive && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <DownloadIcon size={44} />
            <p>Drop files to send to {activeConversation.isGroup ? activeConversation.name : "this chat"}</p>
          </div>
        </div>
      )}

      {pendingFiles && (
        <MediaComposer
          files={pendingFiles}
          conversationLabel={activeConversation.isGroup ? activeConversation.name : "chat"}
          onClose={() => setPendingFiles(null)}
          onSend={async ({ items, caption }) => {
            setPendingFiles(null);
            try {
              const attachments = await uploadFiles(items);
              await sendMessage(activeConversation._id, {
                text: caption,
                attachments,
                replyTo: replyTo?._id,
                replyToMessage: replyTo,
              });
              setReplyTo(null);
            } catch (err) {
              showToast("Upload failed. Try again.", "danger");
            }
          }}
        />
      )}
    </div>
  );
}

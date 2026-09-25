import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { SocketProvider } from "./context/SocketContext.jsx";
import { ChatProvider } from "./context/ChatContext.jsx";
import { StatusProvider } from "./context/StatusContext.jsx";
import { CallProvider } from "./context/CallContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { ContextMenuProvider } from "./context/ContextMenuContext.jsx";
import ErrorBoundary from "./components/common/ErrorBoundary.jsx";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/toast.css";
import "./styles/confirm.css";
import "./styles/liquidglass.css";
import "./styles/call.css";

// Restore stored user accent theme
const savedAccent = localStorage.getItem("wisp_accent");
if (savedAccent && savedAccent !== "default") {
  document.documentElement.setAttribute("data-accent", savedAccent);
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <SocketProvider>
            <ToastProvider>
              <ContextMenuProvider>
                <ChatProvider>
                  <StatusProvider>
                    <CallProvider>
                      <App />
                    </CallProvider>
                  </StatusProvider>
                </ChatProvider>
              </ContextMenuProvider>
            </ToastProvider>
          </SocketProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

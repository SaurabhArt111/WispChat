import { Component } from "react";
import { logError } from "../../utils/logger";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Deliberately doesn't log `info.componentStack` or the error object
    // itself — a component stack can indirectly reveal internal data
    // shapes, and neither is something a person looking at the console
    // needs to see the app is broken.
    logError("ErrorBoundary", error);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="app-boot" style={{ gap: 16, flexDirection: "column" }}>
        <div className="app-boot-mark">wisp</div>
        <p style={{ color: "var(--text-secondary, #9aa0ac)", fontSize: 14, textAlign: "center", maxWidth: 320 }}>
          Something went wrong. Your chats are safe — refreshing usually fixes this.
        </p>
        <button className="btn btn-primary" onClick={this.handleReload}>
          Reload
        </button>
      </div>
    );
  }
}

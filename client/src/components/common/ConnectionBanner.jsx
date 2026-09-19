import { useEffect, useState } from "react";
import { useSocket } from "../../context/SocketContext";

export default function ConnectionBanner() {
  const { socket, connected } = useSocket();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!socket) return;
    // Don't flash the banner for the brief moment during initial page load —
    // only show it once we've actually been connected and then dropped, or
    // if it takes more than a couple seconds to connect the first time.
    const timer = setTimeout(() => setShow(!connected), connected ? 0 : 2000);
    return () => clearTimeout(timer);
  }, [socket, connected]);

  if (!socket || !show) return null;

  return (
    <div className="connection-banner">
      <span className="connection-dot" />
      Reconnecting…
    </div>
  );
}

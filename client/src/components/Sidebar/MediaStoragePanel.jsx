import { useEffect, useState } from "react";
import client from "../../api/client";
import MediaStatsChart from "./MediaStatsChart";
import { LayersIcon } from "../common/Icons";
import "../../styles/railPanels.css";
import "../../styles/mediastats.css";

export default function MediaStoragePanel() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    client
      .get("/messages/media/stats")
      .then((res) => setStats(res.data))
      .catch(() => {});
  }, []);

  return (
    <aside className="rail-panel">
      <div className="rail-panel-header">
        <h2>Media & Storage</h2>
      </div>
      <div className="rail-panel-scroll">
        <div className="rail-panel-section">
          <div className="rail-panel-section-title">
            <LayersIcon size={15} /> Everything you've shared
          </div>
          <MediaStatsChart stats={stats} />
          <p className="rail-panel-hint">
            Files are organized on the server by type — images, videos, audio, documents and
            GIFs each get their own folder — so this breakdown mirrors exactly how your media is
            stored.
          </p>
        </div>
      </div>
    </aside>
  );
}

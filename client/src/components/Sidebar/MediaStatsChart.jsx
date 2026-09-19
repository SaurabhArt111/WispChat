const KIND_META = {
  image: { label: "Images & GIFs", color: "var(--wisp)" },
  video: { label: "Videos", color: "var(--cyan)" },
  audio: { label: "Audio", color: "var(--violet)" },
  file: { label: "Documents", color: "var(--ember)" },
};

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Donut chart summarizing how many attachments of each kind the user has
 * exchanged, and how much disk space they take up — mirrors the
 * images/videos/audio/documents split the server now sorts uploads into.
 * Pure SVG, no charting library, so it costs nothing extra in bundle size.
 */
export default function MediaStatsChart({ stats }) {
  if (!stats || !stats.totalCount) {
    return (
      <div className="media-stats-empty">
        No media shared yet — photos, videos, voice notes and files you send or receive will show up here.
      </div>
    );
  }

  const size = 120;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const segments = Object.entries(stats.counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => {
      const fraction = count / stats.totalCount;
      const dash = fraction * circumference;
      const seg = { kind, count, dash, offset };
      offset += dash;
      return seg;
    });

  return (
    <div className="media-stats-row">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="media-stats-donut">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        {segments.map((seg) => (
          <circle
            key={seg.kind}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={KIND_META[seg.kind]?.color || "var(--text-faint)"}
            strokeWidth={stroke}
            strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
            strokeDashoffset={-seg.offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="butt"
          />
        ))}
        <text x="50%" y="47%" textAnchor="middle" className="media-stats-donut-count">
          {stats.totalCount}
        </text>
        <text x="50%" y="63%" textAnchor="middle" className="media-stats-donut-label">
          files
        </text>
      </svg>

      <div className="media-stats-legend">
        {Object.entries(stats.counts)
          .filter(([, count]) => count > 0)
          .map(([kind, count]) => (
            <div className="media-stats-legend-row" key={kind}>
              <span className="media-stats-dot" style={{ background: KIND_META[kind]?.color }} />
              <span className="media-stats-legend-label">{KIND_META[kind]?.label || kind}</span>
              <span className="media-stats-legend-value">
                {count} · {formatBytes(stats.bytes[kind])}
              </span>
            </div>
          ))}
        <div className="media-stats-legend-total">
          Total: {formatBytes(stats.totalBytes)} across {stats.totalCount} files
        </div>
      </div>
    </div>
  );
}

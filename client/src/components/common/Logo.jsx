import { useId } from "react";

/**
 * The app mark: a speech bubble with a "ping" signal. Pure icon — no lettering —
 * so it reads at any size and in any language. Used on the boot screen, sign-in,
 * the chat list header and the welcome screen.
 */
export default function Logo({ size = 40, pulse = false, tile = false, className = "", title }) {
  const gid = useId().replace(/:/g, "");
  const ring = (ri, ro, a0, a1) => {
    const p = (r, a) => {
      const t = (a * Math.PI) / 180;
      return `${(256 + r * Math.cos(t)).toFixed(1)} ${(226 + r * Math.sin(t)).toFixed(1)}`;
    };
    return `M${p(ro, a0)}A${ro} ${ro} 0 0 1 ${p(ro, a1)}L${p(ri, a1)}A${ri} ${ri} 0 0 0 ${p(ri, a0)}Z`;
  };
  const rings = [
    ring(50, 72, -42, 42),
    ring(50, 72, 138, 222),
    ring(92, 114, -42, 42),
    ring(92, 114, 138, 222),
  ];
  return (
    <svg
      className={`app-logo ${pulse ? "is-pulsing" : ""} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={`g${gid}`} x1="0.05" y1="0" x2="0.95" y2="1">
          <stop offset="0" stopColor="#7bf7d2" />
          <stop offset="0.55" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#8b7cf6" />
        </linearGradient>
        <linearGradient id={`b${gid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#18233a" />
          <stop offset="1" stopColor="#090d16" />
        </linearGradient>
      </defs>
      {tile && <rect width="512" height="512" rx="116" fill={`url(#b${gid})`} />}
      <g transform={tile ? undefined : "translate(0 6)"}>
        <path
          d="M256 78C156 78 76 146 76 230c0 50 27 94 70 120l-18 66c-2 9 8 15 15 10l68-49c14 3 29 4 45 4 100 0 180-68 180-151S356 78 256 78z"
          fill={`url(#g${gid})`}
        />
        <g className="app-logo-rings" fill="#0a1020">
          {rings.map((d, i) => (
            <path key={i} d={d} />
          ))}
          <circle cx="256" cy="226" r="26" />
        </g>
      </g>
    </svg>
  );
}

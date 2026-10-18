import { useEffect, useState } from "react";

/** "mm:ss" since `startAt` (ms timestamp), ticking every second. */
export default function useElapsed(startAt) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startAt) return undefined;
    const tick = () => setElapsed(Math.floor((Date.now() - startAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startAt]);
  const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const s = String(elapsed % 60).padStart(2, "0");
  return `${m}:${s}`;
}

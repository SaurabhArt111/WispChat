import axios from "axios";
import { apiBaseUrl } from "./config";

// 35 s: a free-tier host (Render, etc.) can take 30+ s to wake up. With no timeout the
// first request after opening the app simply hung and the chat never loaded.
const client = axios.create({ baseURL: apiBaseUrl, timeout: 35000 });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("wisp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** True for "the server/network wasn't ready" — as opposed to a real answer like 400/401/404. */
export function isTransientError(err) {
  if (!err) return false;
  if (axios.isCancel?.(err)) return false;
  if (!err.response) return true; // no connection, DNS, timeout, CORS-blocked 502 from a sleeping host…
  const s = err.response.status;
  return s === 502 || s === 503 || s === 504 || s === 408 || s === 429;
}

// Idempotent reads are retried automatically (1.5s, 3s, 6s, 10s). Writes are never
// auto-retried here — sending a message twice is worse than failing once.
client.interceptors.response.use(
  (res) => res,
  async (err) => {
    const cfg = err.config;
    const method = (cfg?.method || "").toLowerCase();
    if (!cfg || method !== "get" || cfg.noRetry || !isTransientError(err)) throw err;
    const delays = [1500, 3000, 6000, 10000];
    cfg.__retry = (cfg.__retry || 0) + 1;
    if (cfg.__retry > delays.length) throw err;
    await wait(delays[cfg.__retry - 1]);
    return client(cfg);
  }
);

export default client;

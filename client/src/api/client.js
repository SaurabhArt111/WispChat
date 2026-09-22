import axios from "axios";
import { apiBaseUrl } from "./config";

const client = axios.create({ baseURL: apiBaseUrl });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("wisp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;

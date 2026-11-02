import mongoose from "mongoose";

// Connect with retries. Previously a single failed attempt (database waking up,
// brief network blip on boot) left the API running forever with no database,
// so every request hung or failed until someone restarted the server by hand.
export async function connectDB() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/wispchat";
  mongoose.set("strictQuery", true);
  mongoose.set("bufferTimeoutMS", 8000); // fail fast instead of hanging a request for 10s+

  mongoose.connection.on("disconnected", () => console.warn("[db] disconnected — the driver will reconnect"));
  mongoose.connection.on("reconnected", () => console.log("[db] reconnected"));

  let attempt = 0;
  for (;;) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 20 });
      console.log("[db] connected");
      return;
    } catch (err) {
      attempt += 1;
      const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
      console.error(`[db] connection failed (attempt ${attempt}): ${err?.message} — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/wispchat";
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("[db] connected:", uri);
}

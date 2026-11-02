import jwt from "jsonwebtoken";

// Read lazily so a value from .env / the host is always honoured.
const secret = () => process.env.JWT_SECRET || "wispchat-dev-secret-change-me";
const EXPIRES_IN = "30d";

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.warn("[auth] JWT_SECRET is not set — using an insecure default. Set a long random value in production.");
}

export function signToken(userId) {
  return jwt.sign({ id: userId }, secret(), { expiresIn: EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, secret());
}

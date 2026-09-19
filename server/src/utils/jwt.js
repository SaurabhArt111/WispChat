import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "wispchat-dev-secret-change-me";
const EXPIRES_IN = "30d";

export function signToken(userId) {
  return jwt.sign({ id: userId }, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

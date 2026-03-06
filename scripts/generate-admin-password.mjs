import crypto from "node:crypto";

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function hashPassword(password, saltBuf, iterations = 150_000, keyLen = 32) {
  return crypto.pbkdf2Sync(String(password), saltBuf, iterations, keyLen, "sha256");
}

const password = process.argv.slice(2).join(" ").trim();
if (!password) {
  console.error('Usage: node scripts/generate-admin-password.mjs "YourStrongPassword"');
  process.exit(1);
}

const iterations = 150_000;
const saltBuf = crypto.randomBytes(16);
const hashBuf = hashPassword(password, saltBuf, iterations);
const passwordHash = `pbkdf2_sha256$${iterations}$${base64UrlEncode(saltBuf)}$${base64UrlEncode(hashBuf)}`;
const authSecret = base64UrlEncode(crypto.randomBytes(32));

console.log("Set these Railway Variables:");
console.log(`ADMIN_PASSWORD_HASH=${passwordHash}`);
console.log(`ADMIN_AUTH_SECRET=${authSecret}`);


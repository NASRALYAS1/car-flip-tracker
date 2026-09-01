// Cloudflare Workers' WebCrypto PBKDF2 implementation hard-caps iterations
// at 100,000 (throws NotSupportedError above that) — this is the max the
// runtime this app actually deploys to will allow, not a security choice.
const PBKDF2_ITERATIONS = 100_000;

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bufToHex(bytes.buffer);
}

async function derive(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBuf(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return bufToHex(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(16);
  const hash = await derive(password, salt);
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = await derive(password, salt);
  if (candidate.length !== hash.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

export function newSessionToken(): string {
  return randomHex(32);
}

const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;

export function sessionCookieHeader(token: string, secure: boolean): string {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secureAttr = secure ? " Secure;" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly;${secureAttr} SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookieHeader(secure: boolean): string {
  const secureAttr = secure ? " Secure;" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secureAttr} SameSite=Lax; Max-Age=0`;
}

export function sessionExpiryIso(): string {
  const d = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(`${SESSION_COOKIE}=`)) {
      return p.substring(SESSION_COOKIE.length + 1);
    }
  }
  return null;
}

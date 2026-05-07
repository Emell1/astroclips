import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SignJWT, jwtVerify } from "jose";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { users } from "./api/database/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In Docker: /app/dist/server.js → public is /app/public
// __dirname = /app/dist → go up one level
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const DATABASE_URL = process.env.DATABASE_URL!;
const JWT_SECRET = process.env.JWT_SECRET!;
const PROCESSOR_URL = process.env.PROCESSOR_URL || "";
const PORT = parseInt(process.env.PORT || "3000");

const sql = postgres(DATABASE_URL, { ssl: "require" });
const db = drizzle(sql);

const app = express();
app.use(express.json());

// Serve static assets
app.use(express.static(PUBLIC_DIR));

// ── Helpers ───────────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(password));
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function createToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
    return payload.userId as string;
  } catch { return null; }
}

async function requireAuth(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace("Bearer ", "") || req.cookies?.session;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const userId = await verifyToken(token);
  if (!userId) return res.status(401).json({ error: "Invalid token" });
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return res.status(401).json({ error: "User not found" });
  req.userId = userId;
  req.userRole = user.role;
  next();
}

// ── Migrations ────────────────────────────────────────────────────────────

async function runMigrations() {
  await sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at BIGINT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL
  )`;
  console.log("Migrations done");
}

// ── Auth routes ───────────────────────────────────────────────────────────

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user || (await hashPassword(password)) !== user.passwordHash)
    return res.status(401).json({ error: "Invalid credentials" });
  const token = await createToken(user.id);
  res.cookie("session", token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("session");
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, async (req: any, res) => {
  const [user] = await db.select({ id: users.id, username: users.username, email: users.email, role: users.role })
    .from(users).where(eq(users.id, req.userId));
  res.json(user);
});

app.post("/api/auth/users", requireAuth, async (req: any, res) => {
  if (req.userRole !== "admin") return res.status(403).json({ error: "Forbidden" });
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: "Missing fields" });
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, username, email, passwordHash: await hashPassword(password), role: role || "user", createdAt: Date.now() });
  res.json({ id, username, email, role: role || "user" });
});

app.get("/api/auth/users", requireAuth, async (req: any, res) => {
  if (req.userRole !== "admin") return res.status(403).json({ error: "Forbidden" });
  res.json(await db.select({ id: users.id, username: users.username, email: users.email, role: users.role, createdAt: users.createdAt }).from(users));
});

app.post("/api/setup", async (req, res) => {
  const existing = await db.select().from(users).limit(1);
  if (existing.length > 0) return res.status(400).json({ error: "Already set up" });
  const { username, email, password } = req.body;
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, username, email, passwordHash: await hashPassword(password), role: "admin", createdAt: Date.now() });
  res.json({ ok: true });
});

// ── Processor proxy ───────────────────────────────────────────────────────

app.all("/api/processor/*", requireAuth, async (req: any, res) => {
  if (!PROCESSOR_URL) return res.status(503).json({ error: "Processor not configured" });
  const proxyPath = req.path.replace("/api/processor", "");
  const url = `${PROCESSOR_URL}${proxyPath}`;

  try {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const headers: Record<string, string> = {};
      if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];

      const fetchRes = await fetch(url, {
        method: req.method,
        headers,
        body: body.length > 0 ? body : undefined,
      });

      res.status(fetchRes.status);
      const ct = fetchRes.headers.get("content-type");
      if (ct) res.setHeader("content-type", ct);
      const buf = await fetchRes.arrayBuffer();
      res.send(Buffer.from(buf));
    });
  } catch (e: any) {
    res.status(502).json({ error: `Processor error: ${e.message}` });
  }
});

app.get("/api/ping", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── SPA fallback ──────────────────────────────────────────────────────────

app.get("/*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────

runMigrations()
  .catch(e => console.error("Migration warning:", e.message))
  .finally(() => app.listen(PORT, () => console.log(`Server on port ${PORT}`)));

import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { users, sessions } from "./database/schema";

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  PROCESSOR_URL: string;   // Railway URL of the Python processor
  ADMIN_EMAIL: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_HASH: string;
};

type Variables = {
  userId: string;
  userRole: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>().basePath("api");

app.use(cors({ origin: "*", credentials: true }));

// ── Helpers ────────────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return (await hashPassword(password)) === hash;
}

async function createToken(userId: string, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(key);
}

async function verifyToken(token: string, secret: string): Promise<string | null> {
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    return payload.userId as string;
  } catch {
    return null;
  }
}

// ── Auth Middleware ────────────────────────────────────────────────────────

async function requireAuth(c: any, next: any) {
  const authHeader = c.req.header("Authorization");
  const cookie = getCookie(c, "session");
  const token = authHeader?.replace("Bearer ", "") || cookie;

  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const userId = await verifyToken(token, c.env.JWT_SECRET);
  if (!userId) return c.json({ error: "Invalid token" }, 401);

  const db = drizzle(c.env.DB);
  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return c.json({ error: "User not found" }, 401);

  c.set("userId", userId);
  c.set("userRole", user.role);
  await next();
}

// ── Auth Routes ────────────────────────────────────────────────────────────

app.post("/auth/login", async (c) => {
  const { username, password } = await c.req.json();
  if (!username || !password) return c.json({ error: "Missing fields" }, 400);

  const db = drizzle(c.env.DB);
  const user = await db.select().from(users)
    .where(eq(users.username, username)).get();

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const token = await createToken(user.id, c.env.JWT_SECRET);

  // Set cookie for browser
  setCookie(c, "session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  return c.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role }
  });
});

app.post("/auth/logout", (c) => {
  deleteCookie(c, "session");
  return c.json({ ok: true });
});

app.get("/auth/me", requireAuth, async (c) => {
  const db = drizzle(c.env.DB);
  const user = await db.select({
    id: users.id, username: users.username, email: users.email, role: users.role
  }).from(users).where(eq(users.id, c.get("userId"))).get();
  return c.json(user);
});

// Admin: create user
app.post("/auth/users", requireAuth, async (c) => {
  if (c.get("userRole") !== "admin") return c.json({ error: "Forbidden" }, 403);
  const { username, email, password, role } = await c.req.json();
  if (!username || !email || !password) return c.json({ error: "Missing fields" }, 400);

  const db = drizzle(c.env.DB);
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    id, username, email, passwordHash,
    role: role || "user",
    createdAt: Date.now(),
  });

  return c.json({ id, username, email, role: role || "user" });
});

// Admin: list users
app.get("/auth/users", requireAuth, async (c) => {
  if (c.get("userRole") !== "admin") return c.json({ error: "Forbidden" }, 403);
  const db = drizzle(c.env.DB);
  const allUsers = await db.select({
    id: users.id, username: users.username, email: users.email,
    role: users.role, createdAt: users.createdAt
  }).from(users).all();
  return c.json(allUsers);
});

// Admin: delete user
app.delete("/auth/users/:id", requireAuth, async (c) => {
  if (c.get("userRole") !== "admin") return c.json({ error: "Forbidden" }, 403);
  const targetId = c.req.param("id");
  if (targetId === c.get("userId")) return c.json({ error: "No puedes eliminarte a ti mismo" }, 400);
  const db = drizzle(c.env.DB);
  await db.delete(users).where(eq(users.id, targetId));
  return c.json({ ok: true });
});

// ── Processor Proxy (authenticated) ───────────────────────────────────────
// Forward all /api/processor/* calls to Railway Python server

app.all("/processor/*", requireAuth, async (c) => {
  const processorUrl = c.env.PROCESSOR_URL;
  if (!processorUrl) return c.json({ error: "Processor not configured" }, 503);

  const path = c.req.path.replace("/api/processor", "");
  const url = `${processorUrl}${path}`;

  const init: RequestInit = {
    method: c.req.method,
    headers: { "Content-Type": c.req.header("Content-Type") || "application/json" },
  };

  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = c.req.raw.body;
  }

  try {
    const resp = await fetch(url, init);
    const contentType = resp.headers.get("content-type") || "application/json";
    const body = await resp.arrayBuffer();
    return new Response(body, {
      status: resp.status,
      headers: { "Content-Type": contentType },
    });
  } catch (e: any) {
    return c.json({ error: `Processor error: ${e.message}` }, 502);
  }
});

// ── Setup: seed admin user ─────────────────────────────────────────────────

app.post("/setup", async (c) => {
  const db = drizzle(c.env.DB);

  // Only works if no users exist
  const existing = await db.select().from(users).limit(1).all();
  if (existing.length > 0) return c.json({ error: "Already set up" }, 400);

  const id = crypto.randomUUID();
  const { username, email, password } = await c.req.json();
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    id, username, email, passwordHash,
    role: "admin",
    createdAt: Date.now(),
  });

  return c.json({ ok: true, message: "Admin created" });
});

app.get("/ping", (c) => c.json({ ok: true, ts: Date.now() }));

export default app;

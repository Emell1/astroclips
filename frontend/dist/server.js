import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { SignJWT, jwtVerify } from "jose";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { users } from "./api/database/schema.js";
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const PROCESSOR_URL = process.env.PROCESSOR_URL || "";
const PORT = parseInt(process.env.PORT || "3000");
const sql = postgres(DATABASE_URL, { ssl: "require" });
const db = drizzle(sql);
// Run migrations on startup
async function runMigrations() {
    await sql `
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      email        TEXT NOT NULL UNIQUE,
      username     TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'user',
      created_at   BIGINT NOT NULL
    )
  `;
    await sql `
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id),
      token      TEXT NOT NULL UNIQUE,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
    console.log("Migrations done");
}
// ── Helpers ────────────────────────────────────────────────────────────────
async function hashPassword(password) {
    const enc = new TextEncoder();
    const data = enc.encode(password);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
}
async function verifyPassword(password, hash) {
    return (await hashPassword(password)) === hash;
}
async function createToken(userId) {
    const key = new TextEncoder().encode(JWT_SECRET);
    return new SignJWT({ userId })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("30d")
        .sign(key);
}
async function verifyToken(token) {
    try {
        const key = new TextEncoder().encode(JWT_SECRET);
        const { payload } = await jwtVerify(token, key);
        return payload.userId;
    }
    catch {
        return null;
    }
}
const app = new Hono();
app.use("*", cors({ origin: "*", credentials: true }));
// ── Auth Middleware ────────────────────────────────────────────────────────
async function requireAuth(c, next) {
    const authHeader = c.req.header("Authorization");
    const cookie = getCookie(c, "session");
    const token = authHeader?.replace("Bearer ", "") || cookie;
    if (!token)
        return c.json({ error: "Unauthorized" }, 401);
    const userId = await verifyToken(token);
    if (!userId)
        return c.json({ error: "Invalid token" }, 401);
    const result = await db.select().from(users).where(eq(users.id, userId));
    const user = result[0];
    if (!user)
        return c.json({ error: "User not found" }, 401);
    c.set("userId", userId);
    c.set("userRole", user.role);
    await next();
}
// ── Auth Routes ────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (c) => {
    const { username, password } = await c.req.json();
    if (!username || !password)
        return c.json({ error: "Missing fields" }, 400);
    const result = await db.select().from(users).where(eq(users.username, username));
    const user = result[0];
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
        return c.json({ error: "Invalid credentials" }, 401);
    }
    const token = await createToken(user.id);
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
app.post("/api/auth/logout", (c) => {
    deleteCookie(c, "session");
    return c.json({ ok: true });
});
app.get("/api/auth/me", requireAuth, async (c) => {
    const result = await db.select({
        id: users.id, username: users.username, email: users.email, role: users.role
    }).from(users).where(eq(users.id, c.get("userId")));
    return c.json(result[0]);
});
app.post("/api/auth/users", requireAuth, async (c) => {
    if (c.get("userRole") !== "admin")
        return c.json({ error: "Forbidden" }, 403);
    const { username, email, password, role } = await c.req.json();
    if (!username || !email || !password)
        return c.json({ error: "Missing fields" }, 400);
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    await db.insert(users).values({
        id, username, email, passwordHash,
        role: role || "user",
        createdAt: Date.now(),
    });
    return c.json({ id, username, email, role: role || "user" });
});
app.get("/api/auth/users", requireAuth, async (c) => {
    if (c.get("userRole") !== "admin")
        return c.json({ error: "Forbidden" }, 403);
    const allUsers = await db.select({
        id: users.id, username: users.username, email: users.email,
        role: users.role, createdAt: users.createdAt
    }).from(users);
    return c.json(allUsers);
});
// ── Setup ──────────────────────────────────────────────────────────────────
app.post("/api/setup", async (c) => {
    const existing = await db.select().from(users).limit(1);
    if (existing.length > 0)
        return c.json({ error: "Already set up" }, 400);
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
// ── Processor Proxy ────────────────────────────────────────────────────────
app.all("/api/processor/*", requireAuth, async (c) => {
    if (!PROCESSOR_URL)
        return c.json({ error: "Processor not configured" }, 503);
    const path = c.req.path.replace("/api/processor", "");
    const url = `${PROCESSOR_URL}${path}`;
    const init = {
        method: c.req.method,
        headers: { "Content-Type": c.req.header("Content-Type") || "application/json" },
    };
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        init.body = c.req.raw.body;
        init.duplex = "half";
    }
    try {
        const resp = await fetch(url, init);
        const contentType = resp.headers.get("content-type") || "application/json";
        const body = await resp.arrayBuffer();
        return new Response(body, {
            status: resp.status,
            headers: { "Content-Type": contentType },
        });
    }
    catch (e) {
        return c.json({ error: `Processor error: ${e.message}` }, 502);
    }
});
app.get("/api/ping", (c) => c.json({ ok: true, ts: Date.now() }));
// ── Serve React SPA ────────────────────────────────────────────────────────
app.use("/*", serveStatic({ root: "./public" }));
app.get("/*", serveStatic({ path: "./public/index.html" }));
// ── Start ──────────────────────────────────────────────────────────────────
runMigrations().then(() => {
    serve({ fetch: app.fetch, port: PORT }, () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
});

const API = "/api";

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
}

export async function login(username: string, password: string): Promise<{ token: string; user: User }> {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    credentials: "include",
  });
  if (!r.ok) {
    const e = await r.json();
    throw new Error(e.error || "Error al iniciar sesión");
  }
  const data = await r.json();
  localStorage.setItem("token", data.token);
  return data;
}

export async function logout() {
  await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
  localStorage.removeItem("token");
}

export async function getMe(): Promise<User | null> {
  const token = localStorage.getItem("token");
  if (!token) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(`${API}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) { localStorage.removeItem("token"); return null; }
    return r.json();
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return localStorage.getItem("token");
}

// Fetch wrapper that adds auth header and points to /api/processor/*
export async function processorFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  return fetch(`${API}/processor${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
}

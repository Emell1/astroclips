import { useEffect, useState } from "react"
import { useLocation } from "wouter"
import { useAuth } from "../hooks/useAuth"

interface User {
  id: string
  username: string
  email: string
  role: string
  createdAt: number
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem("token")
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> || {}) }
  if (token) headers["Authorization"] = `Bearer ${token}`
  return fetch(`/api${path}`, { ...options, headers, credentials: "include" })
}

export default function AdminPage() {
  const { user } = useAuth()
  const [, nav] = useLocation()
  const [userList, setUserList] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // form crear usuario
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "user" })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState("")
  const [createOk, setCreateOk] = useState("")

  // confirmación borrar
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (user && user.role !== "admin") nav("/")
  }, [user])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const r = await apiFetch("/auth/users")
      if (!r.ok) throw new Error("Error cargando usuarios")
      setUserList(await r.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setCreateError("")
    setCreateOk("")
    try {
      const r = await apiFetch("/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (!r.ok) {
        const d = await r.json()
        throw new Error(d.error || "Error al crear usuario")
      }
      const created = await r.json()
      setCreateOk(`Usuario "${created.username}" creado`)
      setForm({ username: "", email: "", password: "", role: "user" })
      loadUsers()
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(true)
    try {
      const r = await apiFetch(`/auth/users/${id}`, { method: "DELETE" })
      if (!r.ok) {
        const d = await r.json()
        throw new Error(d.error || "Error al eliminar")
      }
      setDeleteId(null)
      loadUsers()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const card = { background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 24 }
  const input = {
    width: "100%", padding: "10px 14px", background: "#1a1a26", border: "1px solid #2a2a3a",
    borderRadius: 8, color: "#f0f0f5", fontSize: 14, outline: "none", boxSizing: "border-box" as const,
  }
  const label = { display: "block", color: "#8888a0", fontSize: 12, marginBottom: 6, fontFamily: "JetBrains Mono" }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "32px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <button onClick={() => nav("/")} style={{
          background: "#1a1a26", border: "1px solid #2a2a3a", color: "#8888a0",
          borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 13,
        }}>← Volver</button>
        <div>
          <h1 style={{ fontFamily: "Syne", fontSize: 22, margin: 0, color: "#f0f0f5" }}>Panel Admin</h1>
          <p style={{ color: "#55556a", fontSize: 12, margin: 0 }}>Gestión de usuarios</p>
        </div>
      </div>

      {/* Formulario crear usuario */}
      <div style={{ ...card, marginBottom: 24 }}>
        <h2 style={{ fontFamily: "Syne", fontSize: 16, color: "#f0f0f5", margin: "0 0 20px" }}>
          Crear usuario
        </h2>
        <form onSubmit={handleCreate}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={label}>USUARIO</label>
              <input
                style={input} type="text" placeholder="nombre_usuario" required
                value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div>
              <label style={label}>EMAIL</label>
              <input
                style={input} type="email" placeholder="email@ejemplo.com" required
                value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div>
              <label style={label}>CONTRASEÑA</label>
              <input
                style={input} type="password" placeholder="mínimo 6 caracteres" required
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div>
              <label style={label}>ROL</label>
              <select
                style={{ ...input, cursor: "pointer" }}
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              >
                <option value="user">Usuario</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          {createError && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#ef4444", fontSize: 13 }}>
              {createError}
            </div>
          )}
          {createOk && (
            <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "#10b981", fontSize: 13 }}>
              ✅ {createOk}
            </div>
          )}

          <button type="submit" disabled={creating} style={{
            background: creating ? "#2a2a3a" : "#7c3aed", color: creating ? "#8888a0" : "#fff",
            border: "none", borderRadius: 8, padding: "11px 24px", cursor: creating ? "not-allowed" : "pointer",
            fontWeight: 700, fontSize: 14, fontFamily: "Syne",
          }}>
            {creating ? "Creando..." : "+ Crear usuario"}
          </button>
        </form>
      </div>

      {/* Lista de usuarios */}
      <div style={card}>
        <h2 style={{ fontFamily: "Syne", fontSize: 16, color: "#f0f0f5", margin: "0 0 16px" }}>
          Usuarios ({userList.length})
        </h2>

        {error && (
          <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>
        )}

        {loading ? (
          <div style={{ color: "#55556a", fontSize: 13 }}>Cargando...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {userList.map(u => (
              <div key={u.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "#1a1a26", borderRadius: 8, padding: "12px 16px",
                border: "1px solid #2a2a3a",
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#f0f0f5", fontWeight: 600, fontSize: 14 }}>{u.username}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, fontFamily: "JetBrains Mono",
                      padding: "2px 7px", borderRadius: 5,
                      background: u.role === "admin" ? "rgba(124,58,237,0.2)" : "rgba(16,185,129,0.15)",
                      color: u.role === "admin" ? "#a855f7" : "#10b981",
                      border: `1px solid ${u.role === "admin" ? "rgba(124,58,237,0.4)" : "rgba(16,185,129,0.3)"}`,
                    }}>{u.role.toUpperCase()}</span>
                    {u.id === user?.id && (
                      <span style={{ fontSize: 10, color: "#55556a", fontFamily: "JetBrains Mono" }}>(tú)</span>
                    )}
                  </div>
                  <div style={{ color: "#55556a", fontSize: 12, marginTop: 2 }}>{u.email}</div>
                </div>

                {u.id !== user?.id && deleteId !== u.id && (
                  <button onClick={() => setDeleteId(u.id)} style={{
                    background: "none", border: "1px solid #3a2a2a", color: "#ef4444",
                    borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12,
                  }}>Eliminar</button>
                )}

                {deleteId === u.id && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#8888a0", fontSize: 12 }}>¿Seguro?</span>
                    <button onClick={() => handleDelete(u.id)} disabled={deleting} style={{
                      background: "#ef4444", color: "#fff", border: "none",
                      borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12, fontWeight: 700,
                    }}>{deleting ? "..." : "Sí, borrar"}</button>
                    <button onClick={() => setDeleteId(null)} style={{
                      background: "none", border: "1px solid #2a2a3a", color: "#8888a0",
                      borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12,
                    }}>Cancelar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

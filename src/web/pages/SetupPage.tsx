import { useState } from "react";
import { useLocation } from "wouter";

export default function SetupPage() {
  const [, nav] = useLocation();
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error || "Error");
      }
      setDone(true);
      setTimeout(() => nav("/login"), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", padding: 24, background: "#0a0a0f"
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontFamily: "Syne", fontSize: 32, margin: 0, color: "#f0f0f5" }}>
            Astro<span style={{ color: "#7c3aed" }}>Clips</span>
          </h1>
          <p style={{ color: "#f59e0b", fontSize: 14, marginTop: 8 }}>
            ⚙️ Configuración inicial — crear admin
          </p>
        </div>

        {done ? (
          <div style={{
            background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)",
            borderRadius: 12, padding: 24, textAlign: "center", color: "#10b981"
          }}>
            ✅ Admin creado. Redirigiendo al login...
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{
            background: "#12121a", border: "1px solid #2a2a3a",
            borderRadius: 16, padding: 32,
          }}>
            {["username", "email", "password"].map(field => (
              <div key={field} style={{ marginBottom: 18 }}>
                <label style={{ display: "block", color: "#8888a0", fontSize: 13, marginBottom: 7, textTransform: "capitalize" }}>
                  {field === "username" ? "Usuario" : field === "email" ? "Email" : "Contraseña"}
                </label>
                <input
                  type={field === "password" ? "password" : field === "email" ? "email" : "text"}
                  value={(form as any)[field]}
                  onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  required
                  style={{
                    width: "100%", padding: "11px 14px",
                    background: "#1a1a26", border: "1px solid #2a2a3a",
                    borderRadius: 8, color: "#f0f0f5", fontSize: 14,
                    outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
            ))}

            {error && (
              <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 16 }}>{error}</p>
            )}

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: "12px 0",
              background: loading ? "#2a2a3a" : "#7c3aed",
              color: loading ? "#8888a0" : "#fff",
              border: "none", borderRadius: 8,
              fontFamily: "Syne", fontWeight: 700, fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer",
            }}>
              {loading ? "Creando..." : "Crear admin"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

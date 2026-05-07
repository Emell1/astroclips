import { useState } from "react";
import { useLocation } from "wouter";
import { login } from "../lib/auth";

export default function LoginPage() {
  const [, nav] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(username, password);
      nav("/");
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
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h1 style={{ fontFamily: "Syne", fontSize: 36, margin: 0, color: "#f0f0f5" }}>
            Astro<span style={{ color: "#7c3aed" }}>Clips</span>
          </h1>
          <p style={{ color: "#8888a0", fontSize: 14, marginTop: 8 }}>
            Inicia sesión para continuar
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{
          background: "#12121a", border: "1px solid #2a2a3a",
          borderRadius: 16, padding: 32,
        }}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "#8888a0", fontSize: 13, marginBottom: 8 }}>
              Usuario
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="tu_usuario"
              required
              style={{
                width: "100%", padding: "12px 16px",
                background: "#1a1a26", border: "1px solid #2a2a3a",
                borderRadius: 8, color: "#f0f0f5", fontSize: 15,
                outline: "none", boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "#7c3aed"}
              onBlur={e => e.target.style.borderColor = "#2a2a3a"}
            />
          </div>

          <div style={{ marginBottom: 28 }}>
            <label style={{ display: "block", color: "#8888a0", fontSize: 13, marginBottom: 8 }}>
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: "100%", padding: "12px 16px",
                background: "#1a1a26", border: "1px solid #2a2a3a",
                borderRadius: 8, color: "#f0f0f5", fontSize: 15,
                outline: "none", boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "#7c3aed"}
              onBlur={e => e.target.style.borderColor = "#2a2a3a"}
            />
          </div>

          {error && (
            <div style={{
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8, padding: "10px 14px", marginBottom: 20,
              color: "#ef4444", fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "13px 0",
              background: loading ? "#2a2a3a" : "#7c3aed",
              color: loading ? "#8888a0" : "#fff",
              border: "none", borderRadius: 8,
              fontFamily: "Syne", fontWeight: 700, fontSize: 15,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Entrando..." : "Iniciar sesión"}
          </button>
        </form>

        <p style={{ textAlign: "center", color: "#55556a", fontSize: 12, marginTop: 20 }}>
          ¿Primera vez? Contacta al administrador para obtener acceso.
        </p>
      </div>
    </div>
  );
}

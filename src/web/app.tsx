import { Route, Switch, useLocation } from "wouter";
import { useEffect } from "react";
import { useAuth } from "./hooks/useAuth";
import LoginPage from "./pages/LoginPage";
import SetupPage from "./pages/SetupPage";
import UploadPage from "./pages/UploadPage";
import JobPage from "./pages/JobPage";
import ClipEditorPage from "./pages/ClipEditorPage"
import AdminPage from "./pages/AdminPage";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  const [, nav] = useLocation();

  useEffect(() => {
    if (!loading && !user) nav("/login");
  }, [user, loading]);

  if (loading) return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#0a0a0f"
    }}>
      <div style={{ color: "#8888a0", fontFamily: "DM Sans" }}>Cargando...</div>
    </div>
  );

  if (!user) return null;
  return <Component />;
}

function Header() {
  const { user, logout } = useAuth();
  const [, nav] = useLocation();
  if (!user) return null;
  return (
    <div style={{
      borderBottom: "1px solid #2a2a3a", padding: "12px 32px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "#0a0a0f", position: "sticky", top: 0, zIndex: 100,
    }}>
      <span
        onClick={() => nav("/")}
        style={{ fontFamily: "Syne", fontSize: 20, color: "#f0f0f5", cursor: "pointer" }}
      >
        Astro<span style={{ color: "#7c3aed" }}>Clips</span>
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ color: "#8888a0", fontSize: 13 }}>👤 {user.username}</span>
        {user.role === "admin" && (
          <button onClick={() => nav("/admin")} style={{
            background: "none", border: "1px solid #2a2a3a",
            color: "#8888a0", borderRadius: 6, padding: "5px 12px",
            cursor: "pointer", fontSize: 12
          }}>Admin</button>
        )}
        <button onClick={async () => { await logout(); nav("/login"); }} style={{
          background: "none", border: "1px solid #2a2a3a",
          color: "#8888a0", borderRadius: 6, padding: "5px 12px",
          cursor: "pointer", fontSize: 12
        }}>Salir</button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f" }}>
      <Header />
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/setup" component={SetupPage} />
        <Route path="/" component={() => <ProtectedRoute component={UploadPage} />} />
        <Route path="/job/:id" component={() => <ProtectedRoute component={JobPage} />} />
        <Route path="/job/:id/clip/:index" component={() => <ProtectedRoute component={ClipEditorPage} />} />
        <Route path="/admin" component={() => <ProtectedRoute component={AdminPage} />} />
      </Switch>
    </div>
  );
}

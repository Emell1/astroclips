import { useEffect, useState } from "react"
import { useLocation, useParams } from "wouter"

const API = "/processor"

interface Clip {
  id: number
  start: number
  end: number
  text: string
  score: number
  why: string
  tiktok_caption: string
  visual: {
    has_face: boolean
    has_diagram: boolean
    face_ratio: number
    orig_w: number
    orig_h: number
    face_x: number
    face_y: number
    face_w: number
    face_h: number
  }
}

interface Job {
  id: string
  filename: string
  size_mb: number
  status: string
  progress: number
  step: string
  clips: Clip[]
  error?: string
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#f59e0b" : score >= 45 ? "#10b981" : "#8888a0"
  const label = score >= 70 ? "🔥 Viral" : score >= 45 ? "✅ Bueno" : "💤 Normal"
  return (
    <span style={{
      color, fontSize: 11, fontWeight: 700, padding: "3px 8px",
      borderRadius: 6, border: `1px solid ${color}33`,
      background: `${color}15`, fontFamily: "JetBrains Mono"
    }}>
      {label} {score}
    </span>
  )
}

export default function JobPage() {
  const { id } = useParams()
  const [, nav] = useLocation()
  const [job, setJob] = useState<Job | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${API}/api/job/${id}`)
        const data = await r.json()
        setJob(data)
        if (data.status !== "done" && data.status !== "error") {
          setTimeout(poll, 2000)
        }
      } catch {
        setTimeout(poll, 3000)
      }
    }
    poll()
  }, [id])

  const copyCaption = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopied(idx)
    setTimeout(() => setCopied(null), 2000)
  }

  if (!job) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div style={{ color: "#8888a0" }}>Cargando...</div>
    </div>
  )

  const isProcessing = job.status !== "done" && job.status !== "error"

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
        <button onClick={() => nav("/")} style={{
          background: "#1a1a26", border: "1px solid #2a2a3a", color: "#8888a0",
          borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13
        }}>← Volver</button>
        <div>
          <h1 style={{ fontFamily: "Syne", fontSize: 22, margin: 0, color: "#f0f0f5" }}>
            {job.filename}
          </h1>
          <p style={{ color: "#55556a", fontSize: 12, margin: 0, fontFamily: "JetBrains Mono" }}>
            {job.size_mb} MB · Job {job.id}
          </p>
        </div>
      </div>

      {/* Progress */}
      {isProcessing && (
        <div style={{
          background: "#12121a", border: "1px solid #2a2a3a",
          borderRadius: 12, padding: 24, marginBottom: 32
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ color: "#f0f0f5", fontWeight: 600, fontSize: 15 }}>Analizando video...</span>
            <span style={{ color: "#7c3aed", fontFamily: "JetBrains Mono", fontSize: 14 }}>{job.progress}%</span>
          </div>
          <div style={{ background: "#1a1a26", borderRadius: 8, height: 8, overflow: "hidden", marginBottom: 12 }}>
            <div style={{
              height: "100%", borderRadius: 8,
              background: "linear-gradient(90deg, #7c3aed, #a855f7)",
              width: `${job.progress}%`, transition: "width 0.5s"
            }} />
          </div>
          <p style={{ color: "#8888a0", fontSize: 13, margin: 0 }}>{job.step}</p>
        </div>
      )}

      {/* Error */}
      {job.status === "error" && (
        <div style={{
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          borderRadius: 12, padding: 20, marginBottom: 32, color: "#ef4444"
        }}>
          ⚠ {job.error}
        </div>
      )}

      {/* Results */}
      {job.status === "done" && job.clips.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <h2 style={{ fontFamily: "Syne", fontSize: 20, margin: 0, color: "#f0f0f5" }}>
              {job.clips.length} clips detectados
            </h2>
            <span style={{ color: "#8888a0", fontSize: 13 }}>Ordenados por potencial viral</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {job.clips.map((clip, i) => (
              <div key={i} style={{
                background: "#12121a", border: "1px solid #2a2a3a",
                borderRadius: 12, padding: 20, transition: "border-color 0.2s",
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "#7c3aed")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "#2a2a3a")}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    {/* Top row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                      <span style={{ color: "#55556a", fontFamily: "JetBrains Mono", fontSize: 12 }}>#{i + 1}</span>
                      <ScoreBadge score={clip.score} />
                      <span style={{
                        color: "#8888a0", fontSize: 11, fontFamily: "JetBrains Mono",
                        background: "#1a1a26", padding: "2px 8px", borderRadius: 4
                      }}>
                        {formatTime(clip.start)} → {formatTime(clip.end)} · {Math.round(clip.end - clip.start)}s
                      </span>
                      {clip.visual?.has_face && (
                        <span style={{ fontSize: 11, color: "#10b981" }}>👤 cara detectada</span>
                      )}
                      {clip.visual?.has_diagram && (
                        <span style={{ fontSize: 11, color: "#f59e0b" }}>🔮 diagrama astral</span>
                      )}
                    </div>

                    {/* Why viral */}
                    {clip.why && (
                      <p style={{ color: "#a855f7", fontSize: 13, margin: "0 0 8px 0", fontStyle: "italic" }}>
                        💡 {clip.why}
                      </p>
                    )}

                    {/* Transcript preview */}
                    <p style={{
                      color: "#8888a0", fontSize: 13, margin: "0 0 12px 0",
                      lineHeight: 1.5, display: "-webkit-box",
                      WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden"
                    }}>
                      "{clip.text}"
                    </p>

                    {/* TikTok caption */}
                    {clip.tiktok_caption && (
                      <div style={{
                        background: "#1a1a26", borderRadius: 8, padding: "10px 14px",
                        border: "1px solid #2a2a3a", marginBottom: 12
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ color: "#55556a", fontSize: 11, fontFamily: "JetBrains Mono" }}>
                            DESCRIPCIÓN TIKTOK
                          </span>
                          <button
                            onClick={() => copyCaption(clip.tiktok_caption, i)}
                            style={{
                              background: "none", border: "none", cursor: "pointer",
                              color: copied === i ? "#10b981" : "#8888a0", fontSize: 11
                            }}
                          >
                            {copied === i ? "✓ Copiado" : "Copiar"}
                          </button>
                        </div>
                        <p style={{ color: "#f0f0f5", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                          {clip.tiktok_caption}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Edit button */}
                  <button
                    onClick={() => nav(`/job/${id}/clip/${i}`)}
                    style={{
                      background: "#7c3aed", color: "#fff", border: "none",
                      borderRadius: 8, padding: "10px 18px", cursor: "pointer",
                      fontWeight: 600, fontSize: 13, whiteSpace: "nowrap",
                      flexShrink: 0
                    }}
                  >
                    ✂️ Editar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {job.status === "done" && job.clips.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#8888a0" }}>
          No se encontraron clips suficientemente interesantes. Prueba con otro video.
        </div>
      )}
    </div>
  )
}

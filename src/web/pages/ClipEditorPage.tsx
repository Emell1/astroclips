import { useEffect, useState } from "react"
import { useLocation, useParams } from "wouter"

import { processorFetch, getToken } from "../lib/auth"

interface Visual {
  has_face: boolean
  has_diagram: boolean
  face_x: number
  face_y: number
  face_w: number
  face_h: number
  orig_w: number
  orig_h: number
}

interface Clip {
  id: number
  start: number
  end: number
  text: string
  score: number
  why: string
  tiktok_caption: string
  visual: Visual
}

function LabeledSlider({ label, value, min, max, step = 1, onChange, unit = "" }: any) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: "#8888a0", fontSize: 13 }}>{label}</span>
        <span style={{ color: "#f0f0f5", fontSize: 13, fontFamily: "JetBrains Mono" }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#7c3aed" }}
      />
    </div>
  )
}

export default function ClipEditorPage() {
  const { id, index } = useParams()
  const [, nav] = useLocation()
  const [clip, setClip] = useState<Clip | null>(null)
  const [rendering, setRendering] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState("")
  const [error, setError] = useState("")

  // Layout
  const [layout, setLayout] = useState<"face_only" | "split">("face_only")

  // Face crop (in original pixels)
  const [faceX, setFaceX] = useState(0)
  const [faceY, setFaceY] = useState(0)
  const [faceW, setFaceW] = useState(200)
  const [faceH, setFaceH] = useState(200)

  // Diagram crop
  const [diagX, setDiagX] = useState(0)
  const [diagY, setDiagY] = useState(0)
  const [diagW, setDiagW] = useState(800)
  const [diagH, setDiagH] = useState(600)

  // Logo
  const [showLogo, setShowLogo] = useState(true)
  const [logoSize, setLogoSize] = useState(130)
  const [logoOpacity, setLogoOpacity] = useState(0.6)
  const [logoX, setLogoX] = useState<"right" | "left">("right")
  const [logoY, setLogoY] = useState<"top" | "bottom">("top")

  useEffect(() => {
    processorFetch(`/api/job/${id}`)
      .then(r => r.json())
      .then(job => {
        const c = job.clips[Number(index)]
        setClip(c)
        if (c?.visual) {
          const v = c.visual
          // Antonio's face is typically top-right of Zoom frame
          // Default crop: centered on face with padding
          const padding = 60
          const cx = Math.max(0, v.face_x - v.face_w / 2 - padding)
          const cy = Math.max(0, v.face_y - v.face_h / 2 - padding)
          const cw = Math.min(v.orig_w - cx, v.face_w + padding * 2)
          const ch = Math.min(v.orig_h - cy, v.face_h + padding * 2)
          setFaceX(Math.round(cx))
          setFaceY(Math.round(cy))
          setFaceW(Math.round(cw))
          setFaceH(Math.round(ch))
          // Default diagram: left 75% of video
          setDiagX(0)
          setDiagY(0)
          setDiagW(Math.round(v.orig_w * 0.75))
          setDiagH(v.orig_h)
          if (v.has_diagram) setLayout("split")
        }
      })
  }, [id, index])

  const handleRender = async () => {
    if (!clip) return
    setRendering(true)
    setError("")
    setDownloadUrl("")

    try {
      const config = {
        job_id: id,
        clip_index: Number(index),
        face_crop_x: faceX,
        face_crop_y: faceY,
        face_crop_w: faceW,
        face_crop_h: faceH,
        diagram_crop_x: layout === "split" ? diagX : null,
        diagram_crop_y: layout === "split" ? diagY : null,
        diagram_crop_w: layout === "split" ? diagW : null,
        diagram_crop_h: layout === "split" ? diagH : null,
        layout,
        show_logo: showLogo,
        logo_size: logoSize,
        logo_x: logoX,
        logo_y: logoY,
        logo_opacity: logoOpacity,
      }

      const r = await processorFetch(`/api/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })

      if (!r.ok) throw new Error(await r.text())
      const data = await r.json()
      setDownloadUrl(data.url)
    } catch (e: any) {
      setError(e.message || "Error al renderizar")
    } finally {
      setRendering(false)
    }
  }

  if (!clip) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <span style={{ color: "#8888a0" }}>Cargando clip...</span>
    </div>
  )

  const v = clip.visual
  const origW = v?.orig_w || 1920
  const origH = v?.orig_h || 1080
  const dur = Math.round(clip.end - clip.start)

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
        <button onClick={() => nav(`/job/${id}`)} style={{
          background: "#1a1a26", border: "1px solid #2a2a3a", color: "#8888a0",
          borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13
        }}>← Clips</button>
        <div>
          <h1 style={{ fontFamily: "Syne", fontSize: 20, margin: 0, color: "#f0f0f5" }}>
            Editor de Clip #{Number(index) + 1}
          </h1>
          <p style={{ color: "#55556a", fontSize: 12, margin: 0, fontFamily: "JetBrains Mono" }}>
            {Math.floor(clip.start / 60)}:{String(Math.floor(clip.start % 60)).padStart(2, "0")} → {dur}s · Score {clip.score}
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
        {/* Left: controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Transcription */}
          <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontFamily: "Syne", margin: "0 0 10px 0", fontSize: 15, color: "#f0f0f5" }}>Transcripción</h3>
            <p style={{ color: "#8888a0", fontSize: 13, margin: 0, lineHeight: 1.6 }}>"{clip.text}"</p>
            {clip.why && <p style={{ color: "#a855f7", fontSize: 12, margin: "10px 0 0", fontStyle: "italic" }}>💡 {clip.why}</p>}
          </div>

          {/* Layout */}
          <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontFamily: "Syne", margin: "0 0 14px 0", fontSize: 15, color: "#f0f0f5" }}>Layout</h3>
            <div style={{ display: "flex", gap: 10 }}>
              {[
                { value: "face_only", label: "🎭 Solo cara", desc: "Cara de Antonio a pantalla completa" },
                { value: "split", label: "⬛ Dividido", desc: "Cara arriba 50% + Diagrama abajo 50%" },
              ].map(opt => (
                <button key={opt.value} onClick={() => setLayout(opt.value as any)} style={{
                  flex: 1, padding: "12px 16px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                  border: `1px solid ${layout === opt.value ? "#7c3aed" : "#2a2a3a"}`,
                  background: layout === opt.value ? "rgba(124,58,237,0.15)" : "#1a1a26",
                  color: layout === opt.value ? "#f0f0f5" : "#8888a0",
                }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{opt.label}</div>
                  <div style={{ fontSize: 11 }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Face crop */}
          <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 20 }}>
            <h3 style={{ fontFamily: "Syne", margin: "0 0 14px 0", fontSize: 15, color: "#f0f0f5" }}>
              Recorte de cara
              {v?.has_face && <span style={{ color: "#10b981", fontSize: 11, marginLeft: 8 }}>✓ cara detectada</span>}
            </h3>
            <LabeledSlider label="X (horizontal)" value={faceX} min={0} max={origW - faceW} onChange={setFaceX} unit="px" />
            <LabeledSlider label="Y (vertical)" value={faceY} min={0} max={origH - faceH} onChange={setFaceY} unit="px" />
            <LabeledSlider label="Ancho" value={faceW} min={100} max={origW} onChange={setFaceW} unit="px" />
            <LabeledSlider label="Alto" value={faceH} min={100} max={origH} onChange={setFaceH} unit="px" />
          </div>

          {/* Diagram crop — only in split mode */}
          {layout === "split" && (
            <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 20 }}>
              <h3 style={{ fontFamily: "Syne", margin: "0 0 14px 0", fontSize: 15, color: "#f0f0f5" }}>
                Recorte de presentación / diagrama
                {v?.has_diagram && <span style={{ color: "#f59e0b", fontSize: 11, marginLeft: 8 }}>✓ diagrama detectado</span>}
              </h3>
              <LabeledSlider label="X" value={diagX} min={0} max={origW - diagW} onChange={setDiagX} unit="px" />
              <LabeledSlider label="Y" value={diagY} min={0} max={origH - diagH} onChange={setDiagY} unit="px" />
              <LabeledSlider label="Ancho" value={diagW} min={100} max={origW} onChange={setDiagW} unit="px" />
              <LabeledSlider label="Alto" value={diagH} min={100} max={origH} onChange={setDiagH} unit="px" />
            </div>
          )}

          {/* Logo */}
          <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ fontFamily: "Syne", margin: 0, fontSize: 15, color: "#f0f0f5" }}>Logo</h3>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={showLogo} onChange={e => setShowLogo(e.target.checked)} style={{ accentColor: "#7c3aed" }} />
                <span style={{ color: "#8888a0", fontSize: 13 }}>Mostrar</span>
              </label>
            </div>
            {showLogo && (
              <>
                <LabeledSlider label="Tamaño" value={logoSize} min={60} max={300} onChange={setLogoSize} unit="px" />
                <LabeledSlider label="Opacidad" value={Math.round(logoOpacity * 100)} min={10} max={100}
                  onChange={(v: number) => setLogoOpacity(v / 100)} unit="%" />
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <div>
                    <p style={{ color: "#8888a0", fontSize: 12, margin: "0 0 6px" }}>Posición horizontal</p>
                    <div style={{ display: "flex", gap: 6 }}>
                      {["left", "right"].map(v => (
                        <button key={v} onClick={() => setLogoX(v as any)} style={{
                          padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                          border: `1px solid ${logoX === v ? "#7c3aed" : "#2a2a3a"}`,
                          background: logoX === v ? "rgba(124,58,237,0.2)" : "#1a1a26",
                          color: logoX === v ? "#f0f0f5" : "#8888a0",
                        }}>{v}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p style={{ color: "#8888a0", fontSize: 12, margin: "0 0 6px" }}>Posición vertical</p>
                    <div style={{ display: "flex", gap: 6 }}>
                      {["top", "bottom"].map(v => (
                        <button key={v} onClick={() => setLogoY(v as any)} style={{
                          padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                          border: `1px solid ${logoY === v ? "#7c3aed" : "#2a2a3a"}`,
                          background: logoY === v ? "rgba(124,58,237,0.2)" : "#1a1a26",
                          color: logoY === v ? "#f0f0f5" : "#8888a0",
                        }}>{v}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: preview info + render */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Preview mockup */}
          <div style={{
            background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12,
            padding: 20, textAlign: "center"
          }}>
            <h3 style={{ fontFamily: "Syne", fontSize: 14, margin: "0 0 16px", color: "#f0f0f5" }}>Vista previa del layout</h3>
            {/* 9:16 mockup */}
            <div style={{
              width: 120, height: 213, background: "#000", borderRadius: 8,
              margin: "0 auto 16px", border: "1px solid #2a2a3a",
              display: "flex", flexDirection: "column", overflow: "hidden", position: "relative"
            }}>
              {layout === "face_only" ? (
                <div style={{
                  flex: 1, background: "linear-gradient(135deg, #1a1a26, #12121a)",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}>
                  <span style={{ fontSize: 32 }}>👤</span>
                  {showLogo && (
                    <div style={{
                      position: "absolute",
                      top: logoY === "top" ? 6 : "auto",
                      bottom: logoY === "bottom" ? 6 : "auto",
                      left: logoX === "left" ? 6 : "auto",
                      right: logoX === "right" ? 6 : "auto",
                      fontSize: 8, color: "#8888a0", background: "#2a2a3a",
                      borderRadius: 3, padding: "2px 4px"
                    }}>LOGO</div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{
                    height: "50%", background: "linear-gradient(135deg, #1a1a26, #12121a)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    borderBottom: "1px solid #2a2a3a"
                  }}>
                    <span style={{ fontSize: 24 }}>👤</span>
                  </div>
                  <div style={{
                    height: "50%", background: "#0a0a0f",
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}>
                    <span style={{ fontSize: 20 }}>🔮</span>
                  </div>
                  {showLogo && (
                    <div style={{
                      position: "absolute",
                      top: logoY === "top" ? 6 : "auto",
                      bottom: logoY === "bottom" ? 6 : "auto",
                      left: logoX === "left" ? 6 : "auto",
                      right: logoX === "right" ? 6 : "auto",
                      fontSize: 8, color: "#8888a0", background: "#2a2a3a",
                      borderRadius: 3, padding: "2px 4px"
                    }}>LOGO</div>
                  )}
                </>
              )}
            </div>
            <p style={{ color: "#55556a", fontSize: 11, margin: 0 }}>
              9:16 · 1080×1920 · {dur}s
            </p>
          </div>

          {/* TikTok caption */}
          {clip.tiktok_caption && (
            <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16 }}>
              <p style={{ color: "#55556a", fontSize: 11, fontFamily: "JetBrains Mono", margin: "0 0 8px" }}>
                DESCRIPCIÓN TIKTOK
              </p>
              <p style={{ color: "#f0f0f5", fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
                {clip.tiktok_caption}
              </p>
              <button
                onClick={() => navigator.clipboard.writeText(clip.tiktok_caption)}
                style={{
                  background: "#1a1a26", border: "1px solid #2a2a3a", color: "#8888a0",
                  borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, width: "100%"
                }}
              >
                Copiar descripción
              </button>
            </div>
          )}

          {/* Render button */}
          <button onClick={handleRender} disabled={rendering} style={{
            background: rendering ? "#2a2a3a" : "#7c3aed",
            color: rendering ? "#8888a0" : "#fff",
            border: "none", borderRadius: 10, padding: "14px 20px",
            cursor: rendering ? "not-allowed" : "pointer",
            fontWeight: 700, fontSize: 15, fontFamily: "Syne",
            width: "100%"
          }}>
            {rendering ? "⏳ Renderizando..." : "🎬 Generar clip"}
          </button>

          {error && (
            <p style={{ color: "#ef4444", fontSize: 13, margin: 0, textAlign: "center" }}>⚠ {error}</p>
          )}

          {downloadUrl && (
            <a href={downloadUrl} download style={{
              display: "block", textAlign: "center",
              background: "#10b981", color: "#fff",
              borderRadius: 10, padding: "14px 20px",
              fontWeight: 700, fontSize: 15, fontFamily: "Syne",
              textDecoration: "none"
            }}>
              ⬇ Descargar MP4
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from "react"
import { useLocation, useParams } from "wouter"
import { processorFetch } from "../lib/auth"

interface Clip {
  id: number; start: number; end: number
  text: string; score: number; why: string; tiktok_caption: string
  visual: { has_face: boolean; has_diagram: boolean; face_x: number; face_y: number; face_w: number; face_h: number; orig_w: number; orig_h: number }
}

interface Rect { x: number; y: number; w: number; h: number }

function CropOverlay({
  imgW, imgH, origW, origH, rect, color, label,
  onChange
}: {
  imgW: number; imgH: number; origW: number; origH: number
  rect: Rect; color: string; label: string
  onChange: (r: Rect) => void
}) {
  const scaleX = imgW / origW
  const scaleY = imgH / origH
  const px = rect.x * scaleX, py = rect.y * scaleY
  const pw = rect.w * scaleX, ph = rect.h * scaleY

  const dragRef = useRef<{ type: string; startX: number; startY: number; origRect: Rect } | null>(null)

  const getXY = (e: React.MouseEvent | React.TouchEvent) => {
    const el = (e.currentTarget as HTMLElement).closest(".crop-container") as HTMLElement
    const bounds = el.getBoundingClientRect()
    const cx = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
    const cy = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY
    return { x: cx - bounds.left, y: cy - bounds.top }
  }

  const start = (e: React.MouseEvent | React.TouchEvent, type: string) => {
    e.preventDefault(); e.stopPropagation()
    const { x, y } = getXY(e)
    dragRef.current = { type, startX: x, startY: y, origRect: { ...rect } }

    const move = (ev: MouseEvent | TouchEvent) => {
      if (!dragRef.current) return
      const clientX = "touches" in ev ? (ev as TouchEvent).touches[0].clientX : (ev as MouseEvent).clientX
      const clientY = "touches" in ev ? (ev as TouchEvent).touches[0].clientY : (ev as MouseEvent).clientY
      const el2 = document.querySelector(".crop-container") as HTMLElement
      const bounds2 = el2?.getBoundingClientRect()
      if (!bounds2) return
      const cx2 = clientX - bounds2.left, cy2 = clientY - bounds2.top
      const dx = (cx2 - dragRef.current.startX) / scaleX
      const dy = (cy2 - dragRef.current.startY) / scaleY
      const o = dragRef.current.origRect
      let { x: nx, y: ny, w: nw, h: nh } = o
      const t = dragRef.current.type
      if (t === "move") {
        nx = Math.max(0, Math.min(origW - nw, o.x + dx))
        ny = Math.max(0, Math.min(origH - nh, o.y + dy))
      } else {
        if (t.includes("l")) { nx = Math.max(0, o.x + dx); nw = Math.max(60, o.w - dx) }
        if (t.includes("r")) { nw = Math.max(60, Math.min(origW - nx, o.w + dx)) }
        if (t.includes("t")) { ny = Math.max(0, o.y + dy); nh = Math.max(60, o.h - dy) }
        if (t.includes("b")) { nh = Math.max(60, Math.min(origH - ny, o.h + dy)) }
      }
      onChange({ x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) })
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      window.removeEventListener("touchmove", move)
      window.removeEventListener("touchend", up)
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    window.addEventListener("touchmove", move, { passive: false })
    window.addEventListener("touchend", up)
  }

  const HS = 22 // handle size for touch
  const handles = [
    { t: "tl", x: px - HS/2, y: py - HS/2 },
    { t: "tr", x: px + pw - HS/2, y: py - HS/2 },
    { t: "bl", x: px - HS/2, y: py + ph - HS/2 },
    { t: "br", x: px + pw - HS/2, y: py + ph - HS/2 },
  ]

  return (
    <>
      {/* dim outside */}
      <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.55)", pointerEvents:"none" }} />
      {/* clear window */}
      <div style={{
        position:"absolute", left:px, top:py, width:pw, height:ph,
        boxShadow:`0 0 0 9999px rgba(0,0,0,0.55)`,
        border:`2px solid ${color}`, boxSizing:"border-box",
        cursor:"move", touchAction:"none"
      }}
        onMouseDown={e => start(e, "move")}
        onTouchStart={e => start(e, "move")}
      >
        {/* label */}
        <span style={{
          position:"absolute", top:4, left:6, fontSize:11, fontWeight:700,
          color:color, background:"rgba(0,0,0,0.6)", padding:"2px 6px", borderRadius:4,
          pointerEvents:"none"
        }}>{label}</span>
        {/* crosshair center */}
        <div style={{
          position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
          width:20, height:20, pointerEvents:"none"
        }}>
          <div style={{ position:"absolute", top:"50%", left:0, right:0, height:1, background:color, opacity:0.5 }} />
          <div style={{ position:"absolute", left:"50%", top:0, bottom:0, width:1, background:color, opacity:0.5 }} />
        </div>
      </div>
      {/* corner handles */}
      {handles.map(({ t, x, y }) => (
        <div key={t} style={{
          position:"absolute", left:x, top:y, width:HS, height:HS,
          background:color, borderRadius:4, cursor:"pointer", touchAction:"none",
          zIndex:10, border:"2px solid #000"
        }}
          onMouseDown={e => start(e, t)}
          onTouchStart={e => start(e, t)}
        />
      ))}
    </>
  )
}

export default function ClipEditorPage() {
  const { id, index } = useParams()
  const [, nav] = useLocation()
  const [clip, setClip] = useState<Clip | null>(null)
  const [rendering, setRendering] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState("")
  const [error, setError] = useState("")
  const [frameLoaded, setFrameLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })

  const [layout, setLayout] = useState<"face_only" | "split">("face_only")
  const [face, setFace] = useState<Rect>({ x: 0, y: 0, w: 400, h: 400 })
  const [diag, setDiag] = useState<Rect>({ x: 0, y: 0, w: 800, h: 600 })
  const [showLogo, setShowLogo] = useState(true)
  const [logoSize, setLogoSize] = useState(130)
  const [logoOpacity, setLogoOpacity] = useState(0.6)
  const [logoX, setLogoX] = useState<"right" | "left">("right")
  const [logoY, setLogoY] = useState<"top" | "bottom">("top")

  const origW = clip?.visual?.orig_w || 1920
  const origH = clip?.visual?.orig_h || 1080

  useEffect(() => {
    processorFetch(`/api/job/${id}`).then(r => r.json()).then(job => {
      const c: Clip = job.clips[Number(index)]
      setClip(c)
      if (c?.visual) {
        const v = c.visual
        const pad = 80
        setFace({
          x: Math.max(0, Math.round(v.face_x - v.face_w / 2 - pad)),
          y: Math.max(0, Math.round(v.face_y - v.face_h / 2 - pad)),
          w: Math.min(v.orig_w, Math.round(v.face_w + pad * 2)),
          h: Math.min(v.orig_h, Math.round(v.face_h + pad * 2)),
        })
        setDiag({ x: 0, y: 0, w: Math.round(v.orig_w * 0.75), h: v.orig_h })
        if (v.has_diagram) setLayout("split")
      }
    })
  }, [id, index])

  const frameUrl = clip ? `/api/processor/api/frame/${id}?t=${Math.round(clip.start + (clip.end - clip.start) / 2)}` : ""

  const handleImgLoad = () => {
    if (imgRef.current) {
      setImgSize({ w: imgRef.current.offsetWidth, h: imgRef.current.offsetHeight })
      setFrameLoaded(true)
    }
  }

  const handleRender = async () => {
    if (!clip) return
    setRendering(true); setError(""); setDownloadUrl("")
    try {
      const r = await processorFetch(`/api/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: id, clip_index: Number(index),
          face_crop_x: face.x, face_crop_y: face.y, face_crop_w: face.w, face_crop_h: face.h,
          diagram_crop_x: layout === "split" ? diag.x : null,
          diagram_crop_y: layout === "split" ? diag.y : null,
          diagram_crop_w: layout === "split" ? diag.w : null,
          diagram_crop_h: layout === "split" ? diag.h : null,
          layout, show_logo: showLogo,
          logo_size: logoSize, logo_x: logoX, logo_y: logoY, logo_opacity: logoOpacity,
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      const data = await r.json()
      setDownloadUrl(`/api/processor${data.url}`)
    } catch (e: any) {
      setError(e.message || "Error al renderizar")
    } finally {
      setRendering(false)
    }
  }

  if (!clip) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0a0a0f" }}>
      <span style={{ color: "#8888a0" }}>Cargando...</span>
    </div>
  )

  const dur = Math.round(clip.end - clip.start)

  return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", padding: "12px" }}>
      <div style={{ maxWidth: 600, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => nav(`/job/${id}`)} style={{
            background: "#1a1a26", border: "1px solid #2a2a3a", color: "#8888a0",
            borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13
          }}>← Volver</button>
          <div>
            <div style={{ color: "#f0f0f5", fontWeight: 700, fontSize: 15 }}>Clip #{Number(index) + 1}</div>
            <div style={{ color: "#55556a", fontSize: 11 }}>{dur}s · Score {clip.score}</div>
          </div>
        </div>

        {/* Layout toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {[{ v: "face_only" as const, label: "🎭 Solo cara" }, { v: "split" as const, label: "⬛ Cara + Pres." }].map(opt => (
            <button key={opt.v} onClick={() => setLayout(opt.v)} style={{
              flex: 1, padding: "10px", borderRadius: 8, cursor: "pointer",
              border: `1px solid ${layout === opt.v ? "#7c3aed" : "#2a2a3a"}`,
              background: layout === opt.v ? "rgba(124,58,237,0.2)" : "#1a1a26",
              color: layout === opt.v ? "#f0f0f5" : "#8888a0", fontSize: 13, fontWeight: 600
            }}>{opt.label}</button>
          ))}
        </div>

        {/* Frame + crop editor */}
        <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #1a1a26" }}>
            <span style={{ color: "#55556a", fontSize: 11, fontFamily: "JetBrains Mono" }}>
              ARRASTRA LAS ESQUINAS PARA RECORTAR
            </span>
          </div>
          <div className="crop-container" style={{ position: "relative", width: "100%", touchAction: "none" }}>
            {/* Frame image */}
            <img
              ref={imgRef}
              src={frameUrl}
              alt="frame"
              style={{ width: "100%", display: "block", opacity: frameLoaded ? 1 : 0 }}
              onLoad={handleImgLoad}
              onError={() => setFrameLoaded(false)}
            />
            {/* Placeholder if no frame */}
            {!frameLoaded && (
              <div style={{
                width: "100%", paddingBottom: `${(origH / origW) * 100}%`,
                background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center"
              }}>
                <span style={{ position: "absolute", color: "#55556a", fontSize: 13 }}>Cargando frame...</span>
              </div>
            )}
            {/* Crop overlays — only when image is loaded */}
            {frameLoaded && imgSize.w > 0 && (
              <>
                <CropOverlay
                  imgW={imgSize.w} imgH={imgSize.h}
                  origW={origW} origH={origH}
                  rect={face} color="#a855f7" label="CARA"
                  onChange={setFace}
                />
                {layout === "split" && (
                  <CropOverlay
                    imgW={imgSize.w} imgH={imgSize.h}
                    origW={origW} origH={origH}
                    rect={diag} color="#f59e0b" label="PRESENTACIÓN"
                    onChange={setDiag}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Output preview mockup — vertical 9:16 */}
        <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <p style={{ color: "#55556a", fontSize: 11, fontFamily: "JetBrains Mono", margin: "0 0 12px" }}>RESULTADO (9:16)</p>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{
              width: 100, height: 178, background: "#000", borderRadius: 8,
              border: "1px solid #2a2a3a", overflow: "hidden", position: "relative",
              display: "flex", flexDirection: "column"
            }}>
              {layout === "face_only" ? (
                <div style={{ flex: 1, background: "linear-gradient(135deg,#1a1a26,#12121a)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 28 }}>👤</span>
                </div>
              ) : (
                <>
                  <div style={{ height: "50%", background: "linear-gradient(135deg,#1a1a26,#12121a)", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "1px solid #2a2a3a" }}>
                    <span style={{ fontSize: 20 }}>👤</span>
                  </div>
                  <div style={{ height: "50%", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: 18 }}>🔮</span>
                  </div>
                </>
              )}
              {showLogo && (
                <div style={{
                  position: "absolute",
                  top: logoY === "top" ? 5 : "auto", bottom: logoY === "bottom" ? 5 : "auto",
                  left: logoX === "left" ? 5 : "auto", right: logoX === "right" ? 5 : "auto",
                  fontSize: 7, color: "#8888a0", background: "rgba(0,0,0,0.6)",
                  borderRadius: 3, padding: "2px 4px"
                }}>LOGO</div>
              )}
            </div>
          </div>
        </div>

        {/* Logo */}
        <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ color: "#f0f0f5", fontSize: 14, fontWeight: 600 }}>Logo</span>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={showLogo} onChange={e => setShowLogo(e.target.checked)} style={{ accentColor: "#7c3aed", width: 18, height: 18 }} />
              <span style={{ color: "#8888a0", fontSize: 13 }}>Mostrar</span>
            </label>
          </div>
          {showLogo && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <p style={{ color: "#55556a", fontSize: 11, margin: "0 0 4px" }}>TAMAÑO: {logoSize}px</p>
                <input type="range" min={60} max={300} value={logoSize} onChange={e => setLogoSize(Number(e.target.value))} style={{ width: "100%", accentColor: "#7c3aed" }} />
              </div>
              <div>
                <p style={{ color: "#55556a", fontSize: 11, margin: "0 0 4px" }}>OPACIDAD: {Math.round(logoOpacity * 100)}%</p>
                <input type="range" min={10} max={100} value={Math.round(logoOpacity * 100)} onChange={e => setLogoOpacity(Number(e.target.value) / 100)} style={{ width: "100%", accentColor: "#7c3aed" }} />
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <p style={{ color: "#55556a", fontSize: 11, margin: "0 0 6px" }}>POSICIÓN</p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(["top", "bottom"] as const).map(v => (
                    <button key={v} onClick={() => setLogoY(v)} style={{
                      padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                      border: `1px solid ${logoY === v ? "#7c3aed" : "#2a2a3a"}`,
                      background: logoY === v ? "rgba(124,58,237,0.2)" : "#1a1a26",
                      color: logoY === v ? "#f0f0f5" : "#8888a0"
                    }}>{v === "top" ? "Arriba" : "Abajo"}</button>
                  ))}
                  {(["left", "right"] as const).map(v => (
                    <button key={v} onClick={() => setLogoX(v)} style={{
                      padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12,
                      border: `1px solid ${logoX === v ? "#7c3aed" : "#2a2a3a"}`,
                      background: logoX === v ? "rgba(124,58,237,0.2)" : "#1a1a26",
                      color: logoX === v ? "#f0f0f5" : "#8888a0"
                    }}>{v === "left" ? "Izquierda" : "Derecha"}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Caption */}
        {clip.tiktok_caption && (
          <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <p style={{ color: "#55556a", fontSize: 11, fontFamily: "JetBrains Mono", margin: "0 0 8px" }}>DESCRIPCIÓN TIKTOK</p>
            <p style={{ color: "#f0f0f5", fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>{clip.tiktok_caption}</p>
            <button onClick={() => navigator.clipboard.writeText(clip.tiktok_caption)} style={{
              background: "#1a1a26", border: "1px solid #2a2a3a", color: "#8888a0",
              borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontSize: 12, width: "100%"
            }}>Copiar descripción</button>
          </div>
        )}

        {/* Render */}
        <button onClick={handleRender} disabled={rendering} style={{
          background: rendering ? "#2a2a3a" : "#7c3aed", color: rendering ? "#8888a0" : "#fff",
          border: "none", borderRadius: 10, padding: "16px",
          cursor: rendering ? "not-allowed" : "pointer",
          fontWeight: 700, fontSize: 16, width: "100%", marginBottom: 10
        }}>
          {rendering ? "⏳ Renderizando..." : "🎬 Generar clip"}
        </button>

        {error && <p style={{ color: "#ef4444", fontSize: 13, textAlign: "center", marginBottom: 10 }}>⚠ {error}</p>}

        {downloadUrl && (
          <a href={downloadUrl} download style={{
            display: "block", textAlign: "center",
            background: "#10b981", color: "#fff",
            borderRadius: 10, padding: "16px",
            fontWeight: 700, fontSize: 16, textDecoration: "none"
          }}>⬇ Descargar MP4</a>
        )}

      </div>
    </div>
  )
}

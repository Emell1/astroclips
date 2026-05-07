import { useEffect, useRef, useState, useCallback } from "react"
import { useLocation, useParams } from "wouter"
import { processorFetch } from "../lib/auth"

interface Visual {
  has_face: boolean
  has_diagram: boolean
  face_x: number; face_y: number; face_w: number; face_h: number
  orig_w: number; orig_h: number
}
interface Clip {
  id: number; start: number; end: number
  text: string; score: number; why: string; tiktok_caption: string
  visual: Visual
}

// Drag handles for crop box
type Handle = "tl"|"tr"|"bl"|"br"|"move"|null

function CropBox({
  label, color, x, y, w, h, maxW, maxH, scale,
  onChange
}: {
  label: string; color: string
  x: number; y: number; w: number; h: number
  maxW: number; maxH: number; scale: number
  onChange: (x:number,y:number,w:number,h:number) => void
}) {
  const dragging = useRef<{handle: Handle; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number}|null>(null)

  const px = x * scale, py = y * scale, pw = w * scale, ph = h * scale

  const onMouseDown = (e: React.MouseEvent|React.TouchEvent, handle: Handle) => {
    e.preventDefault()
    e.stopPropagation()
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY
    dragging.current = { handle, startX: clientX, startY: clientY, origX: x, origY: y, origW: w, origH: h }

    const onMove = (e2: MouseEvent|TouchEvent) => {
      if (!dragging.current) return
      const cx = "touches" in e2 ? (e2 as TouchEvent).touches[0].clientX : (e2 as MouseEvent).clientX
      const cy = "touches" in e2 ? (e2 as TouchEvent).touches[0].clientY : (e2 as MouseEvent).clientY
      const dx = (cx - dragging.current.startX) / scale
      const dy = (cy - dragging.current.startY) / scale
      let { origX: nx, origY: ny, origW: nw, origH: nh } = dragging.current

      if (handle === "move") {
        nx = Math.max(0, Math.min(maxW - nw, origX + dx))  // eslint-disable-line
        ny = Math.max(0, Math.min(maxH - nh, origY + dy))  // eslint-disable-line
        const { origX, origY } = dragging.current
        nx = Math.max(0, Math.min(maxW - origW, origX + dx))
        ny = Math.max(0, Math.min(maxH - origH, origY + dy))
        onChange(Math.round(nx), Math.round(ny), origW, origH)
      } else {
        const { origX, origY, origW, origH } = dragging.current
        if (handle === "tl") {
          nx = Math.max(0, origX + dx); ny = Math.max(0, origY + dy)
          nw = Math.max(50, origW - dx); nh = Math.max(50, origH - dy)
        } else if (handle === "tr") {
          ny = Math.max(0, origY + dy)
          nw = Math.max(50, origW + dx); nh = Math.max(50, origH - dy)
          nx = origX
        } else if (handle === "bl") {
          nx = Math.max(0, origX + dx)
          nw = Math.max(50, origW - dx); nh = Math.max(50, origH + dy)
          ny = origY
        } else if (handle === "br") {
          nw = Math.max(50, origW + dx); nh = Math.max(50, origH + dy)
          nx = origX; ny = origY
        }
        nw = Math.min(maxW - nx, nw); nh = Math.min(maxH - ny, nh)
        onChange(Math.round(nx), Math.round(ny), Math.round(nw), Math.round(nh))
      }
    }

    const onUp = () => {
      dragging.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
      window.removeEventListener("touchmove", onMove)
      window.removeEventListener("touchend", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    window.addEventListener("touchmove", onMove, { passive: false })
    window.addEventListener("touchend", onUp)
  }

  const hs = 14 // handle size
  const handles: { h: Handle; sx: number; sy: number; cx: number; cy: number }[] = [
    { h:"tl", sx:-hs/2, sy:-hs/2, cx:px, cy:py },
    { h:"tr", sx:-hs/2, sy:-hs/2, cx:px+pw, cy:py },
    { h:"bl", sx:-hs/2, sy:-hs/2, cx:px, cy:py+ph },
    { h:"br", sx:-hs/2, sy:-hs/2, cx:px+pw, cy:py+ph },
  ]

  return (
    <g>
      {/* Overlay dimming */}
      <rect x={px} y={py} width={pw} height={ph}
        fill="none" stroke={color} strokeWidth={2}
        onMouseDown={e => onMouseDown(e, "move")}
        onTouchStart={e => onMouseDown(e, "move")}
        style={{ cursor: "move" }}
      />
      {/* Label */}
      <text x={px+6} y={py+16} fill={color} fontSize={12} fontWeight="bold">{label}</text>
      {/* Corner handles */}
      {handles.map(({ h, cx, cy }) => (
        <rect key={h} x={cx-hs/2} y={cy-hs/2} width={hs} height={hs}
          fill={color} rx={3}
          onMouseDown={e => onMouseDown(e, h)}
          onTouchStart={e => onMouseDown(e, h)}
          style={{ cursor: h === "tl"||h === "br" ? "nwse-resize" : "nesw-resize" }}
        />
      ))}
    </g>
  )
}

export default function ClipEditorPage() {
  const { id, index } = useParams()
  const [, nav] = useLocation()
  const [clip, setClip] = useState<Clip | null>(null)
  const [rendering, setRendering] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState("")
  const [error, setError] = useState("")
  const [frameUrl, setFrameUrl] = useState("")
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 })
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerW, setContainerW] = useState(600)

  const [layout, setLayout] = useState<"face_only"|"split">("face_only")
  const [faceX, setFaceX] = useState(0); const [faceY, setFaceY] = useState(0)
  const [faceW, setFaceW] = useState(400); const [faceH, setFaceH] = useState(400)
  const [diagX, setDiagX] = useState(0); const [diagY, setDiagY] = useState(0)
  const [diagW, setDiagW] = useState(800); const [diagH, setDiagH] = useState(600)
  const [showLogo, setShowLogo] = useState(true)
  const [logoSize, setLogoSize] = useState(130)
  const [logoOpacity, setLogoOpacity] = useState(0.6)
  const [logoX, setLogoX] = useState<"right"|"left">("right")
  const [logoY, setLogoY] = useState<"top"|"bottom">("top")

  const origW = clip?.visual?.orig_w || 1920
  const origH = clip?.visual?.orig_h || 1080
  const scale = containerW / origW

  // Responsive container width
  useEffect(() => {
    const update = () => {
      if (containerRef.current) setContainerW(containerRef.current.offsetWidth)
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [clip])

  useEffect(() => {
    processorFetch(`/api/job/${id}`).then(r => r.json()).then(job => {
      const c = job.clips[Number(index)]
      setClip(c)
      if (c?.visual) {
        const v = c.visual
        if (v.has_face) {
          const pad = 80
          setFaceX(Math.max(0, Math.round(v.face_x - v.face_w/2 - pad)))
          setFaceY(Math.max(0, Math.round(v.face_y - v.face_h/2 - pad)))
          setFaceW(Math.min(v.orig_w, Math.round(v.face_w + pad*2)))
          setFaceH(Math.min(v.orig_h, Math.round(v.face_h + pad*2)))
        } else {
          setFaceX(Math.round(v.orig_w * 0.5)); setFaceY(0)
          setFaceW(Math.round(v.orig_w * 0.5)); setFaceH(v.orig_h)
        }
        setDiagX(0); setDiagY(0)
        setDiagW(Math.round(v.orig_w * 0.75)); setDiagH(v.orig_h)
        if (v.has_diagram) setLayout("split")
      }
      // Load frame thumbnail
      const t = c.start + (c.end - c.start) / 2
      setFrameUrl(`/api/processor/api/frame/${job.id}?t=${t}`)
    })
  }, [id, index])

  const handleRender = async () => {
    if (!clip) return
    setRendering(true); setError(""); setDownloadUrl("")
    try {
      const r = await processorFetch(`/api/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: id, clip_index: Number(index),
          face_crop_x: faceX, face_crop_y: faceY, face_crop_w: faceW, face_crop_h: faceH,
          diagram_crop_x: layout === "split" ? diagX : null,
          diagram_crop_y: layout === "split" ? diagY : null,
          diagram_crop_w: layout === "split" ? diagW : null,
          diagram_crop_h: layout === "split" ? diagH : null,
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
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#0a0a0f" }}>
      <span style={{ color:"#8888a0" }}>Cargando...</span>
    </div>
  )

  const dur = Math.round(clip.end - clip.start)

  return (
    <div style={{ background:"#0a0a0f", minHeight:"100vh", padding:"16px" }}>
      <div style={{ maxWidth:900, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
          <button onClick={() => nav(`/job/${id}`)} style={{
            background:"#1a1a26", border:"1px solid #2a2a3a", color:"#8888a0",
            borderRadius:8, padding:"8px 14px", cursor:"pointer", fontSize:13, whiteSpace:"nowrap"
          }}>← Volver</button>
          <div>
            <h1 style={{ fontFamily:"Syne", fontSize:18, margin:0, color:"#f0f0f5" }}>
              Clip #{Number(index)+1}
            </h1>
            <p style={{ color:"#55556a", fontSize:11, margin:0, fontFamily:"JetBrains Mono" }}>
              {dur}s · Score {clip.score}
            </p>
          </div>
        </div>

        {/* Layout selector */}
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          {[{v:"face_only" as const, label:"🎭 Solo cara"}, {v:"split" as const, label:"⬛ Cara + Presentación"}].map(opt => (
            <button key={opt.v} onClick={() => setLayout(opt.v)} style={{
              flex:1, padding:"10px", borderRadius:8, cursor:"pointer",
              border:`1px solid ${layout===opt.v?"#7c3aed":"#2a2a3a"}`,
              background:layout===opt.v?"rgba(124,58,237,0.15)":"#1a1a26",
              color:layout===opt.v?"#f0f0f5":"#8888a0", fontSize:13, fontWeight:600
            }}>{opt.label}</button>
          ))}
        </div>

        {/* Visual crop editor */}
        <div ref={containerRef} style={{ background:"#12121a", border:"1px solid #2a2a3a", borderRadius:12, overflow:"hidden", marginBottom:16, position:"relative" }}>
          <p style={{ color:"#55556a", fontSize:11, margin:0, padding:"8px 12px", fontFamily:"JetBrains Mono" }}>
            ARRASTRA LAS ESQUINAS PARA AJUSTAR EL RECORTE
          </p>
          <div style={{ position:"relative", width:"100%" }}>
            {frameUrl ? (
              <img
                src={frameUrl}
                alt="frame"
                style={{ width:"100%", display:"block" }}
                onLoad={e => {
                  const img = e.currentTarget
                  setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
                  if (containerRef.current) setContainerW(containerRef.current.offsetWidth)
                }}
                onError={() => setFrameUrl("")}
              />
            ) : (
              <div style={{ width:"100%", paddingBottom:`${(origH/origW)*100}%`, background:"#0a0a0f" }} />
            )}
            {/* SVG overlay for crop boxes */}
            <svg
              style={{ position:"absolute", top:0, left:0, width:"100%", height:"100%", overflow:"visible" }}
              viewBox={`0 0 ${containerW} ${containerW * origH / origW}`}
            >
              {/* Dark overlay outside face crop */}
              <rect x={0} y={0} width={containerW} height={containerW * origH / origW} fill="rgba(0,0,0,0.5)" />
              {/* Cut out crop areas */}
              <rect x={faceX*scale} y={faceY*scale} width={faceW*scale} height={faceH*scale} fill="rgba(0,0,0,0)" />
              {layout==="split" && <rect x={diagX*scale} y={diagY*scale} width={diagW*scale} height={diagH*scale} fill="rgba(0,0,0,0)" />}

              <CropBox label="CARA" color="#a855f7"
                x={faceX} y={faceY} w={faceW} h={faceH}
                maxW={origW} maxH={origH} scale={scale}
                onChange={(x,y,w,h) => { setFaceX(x); setFaceY(y); setFaceW(w); setFaceH(h) }}
              />
              {layout==="split" && (
                <CropBox label="PRESENTACIÓN" color="#f59e0b"
                  x={diagX} y={diagY} w={diagW} h={diagH}
                  maxW={origW} maxH={origH} scale={scale}
                  onChange={(x,y,w,h) => { setDiagX(x); setDiagY(y); setDiagW(w); setDiagH(h) }}
                />
              )}
            </svg>
          </div>
        </div>

        {/* Logo options */}
        <div style={{ background:"#12121a", border:"1px solid #2a2a3a", borderRadius:12, padding:16, marginBottom:16 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <span style={{ color:"#f0f0f5", fontSize:14, fontWeight:600 }}>Logo</span>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
              <input type="checkbox" checked={showLogo} onChange={e => setShowLogo(e.target.checked)} style={{ accentColor:"#7c3aed", width:16, height:16 }} />
              <span style={{ color:"#8888a0", fontSize:13 }}>Mostrar</span>
            </label>
          </div>
          {showLogo && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div>
                <p style={{ color:"#55556a", fontSize:11, margin:"0 0 6px" }}>TAMAÑO</p>
                <input type="range" min={60} max={300} value={logoSize}
                  onChange={e => setLogoSize(Number(e.target.value))}
                  style={{ width:"100%", accentColor:"#7c3aed" }} />
                <span style={{ color:"#8888a0", fontSize:12 }}>{logoSize}px</span>
              </div>
              <div>
                <p style={{ color:"#55556a", fontSize:11, margin:"0 0 6px" }}>OPACIDAD</p>
                <input type="range" min={10} max={100} value={Math.round(logoOpacity*100)}
                  onChange={e => setLogoOpacity(Number(e.target.value)/100)}
                  style={{ width:"100%", accentColor:"#7c3aed" }} />
                <span style={{ color:"#8888a0", fontSize:12 }}>{Math.round(logoOpacity*100)}%</span>
              </div>
              <div>
                <p style={{ color:"#55556a", fontSize:11, margin:"0 0 6px" }}>POSICIÓN</p>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {(["top","bottom"] as const).map(v => (
                    <button key={v} onClick={() => setLogoY(v)} style={{
                      padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:12,
                      border:`1px solid ${logoY===v?"#7c3aed":"#2a2a3a"}`,
                      background:logoY===v?"rgba(124,58,237,0.2)":"#1a1a26",
                      color:logoY===v?"#f0f0f5":"#8888a0"
                    }}>{v==="top"?"Arriba":"Abajo"}</button>
                  ))}
                  {(["left","right"] as const).map(v => (
                    <button key={v} onClick={() => setLogoX(v)} style={{
                      padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:12,
                      border:`1px solid ${logoX===v?"#7c3aed":"#2a2a3a"}`,
                      background:logoX===v?"rgba(124,58,237,0.2)":"#1a1a26",
                      color:logoX===v?"#f0f0f5":"#8888a0"
                    }}>{v==="left"?"Izq":"Der"}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Caption */}
        {clip.tiktok_caption && (
          <div style={{ background:"#12121a", border:"1px solid #2a2a3a", borderRadius:12, padding:16, marginBottom:16 }}>
            <p style={{ color:"#55556a", fontSize:11, fontFamily:"JetBrains Mono", margin:"0 0 8px" }}>DESCRIPCIÓN TIKTOK</p>
            <p style={{ color:"#f0f0f5", fontSize:13, margin:"0 0 10px", lineHeight:1.5 }}>{clip.tiktok_caption}</p>
            <button onClick={() => navigator.clipboard.writeText(clip.tiktok_caption)} style={{
              background:"#1a1a26", border:"1px solid #2a2a3a", color:"#8888a0",
              borderRadius:6, padding:"8px 12px", cursor:"pointer", fontSize:12, width:"100%"
            }}>Copiar descripción</button>
          </div>
        )}

        {/* Render + Download */}
        <button onClick={handleRender} disabled={rendering} style={{
          background:rendering?"#2a2a3a":"#7c3aed", color:rendering?"#8888a0":"#fff",
          border:"none", borderRadius:10, padding:"16px",
          cursor:rendering?"not-allowed":"pointer",
          fontWeight:700, fontSize:16, fontFamily:"Syne", width:"100%", marginBottom:12
        }}>
          {rendering ? "⏳ Renderizando..." : "🎬 Generar clip"}
        </button>

        {error && <p style={{ color:"#ef4444", fontSize:13, textAlign:"center", marginBottom:12 }}>⚠ {error}</p>}

        {downloadUrl && (
          <a href={downloadUrl} download style={{
            display:"block", textAlign:"center",
            background:"#10b981", color:"#fff",
            borderRadius:10, padding:"16px",
            fontWeight:700, fontSize:16, fontFamily:"Syne",
            textDecoration:"none", marginBottom:12
          }}>⬇ Descargar MP4</a>
        )}
      </div>
    </div>
  )
}

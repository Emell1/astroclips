import { useEffect, useRef, useState, useCallback } from "react"
import { useLocation, useParams } from "wouter"
import { processorFetch } from "../lib/auth"

// ── Types ────────────────────────────────────────────────────────────────

interface Clip {
  id: number; start: number; end: number
  text: string; score: number; why: string; tiktok_caption: string
  visual: { has_face: boolean; has_diagram: boolean; face_x: number; face_y: number; face_w: number; face_h: number; orig_w: number; orig_h: number }
}

// Layer: position/size in 0..1 coords relative to the 9:16 canvas
interface Layer {
  id: string
  visible: boolean
  // source crop in original video pixels
  srcX: number; srcY: number; srcW: number; srcH: number
  // dest on canvas in 0..1 units
  x: number; y: number; w: number; h: number
}

// ── Canvas constants ─────────────────────────────────────────────────────
const CANVAS_W = 720
const CANVAS_H = 1280

// ── Drag logic (dest layer) ──────────────────────────────────────────────
type DragHandle = "move" | "tl" | "tr" | "bl" | "br"

function useLayerDrag(
  canvasRef: React.RefObject<HTMLDivElement | null>,
  layers: Record<string, Layer>,
  setLayers: React.Dispatch<React.SetStateAction<Record<string, Layer>>>,
  displayW: number,
  displayH: number,
) {
  const dragging = useRef<{ id: string; handle: DragHandle; startX: number; startY: number; origLayer: Layer } | null>(null)

  const startDrag = useCallback((e: React.MouseEvent | React.TouchEvent, id: string, handle: DragHandle) => {
    e.preventDefault(); e.stopPropagation()
    const pt = "touches" in e ? e.touches[0] : e
    dragging.current = { id, handle, startX: pt.clientX, startY: pt.clientY, origLayer: { ...layers[id] } }

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!dragging.current) return
      const { id, handle, startX, startY, origLayer: o } = dragging.current
      const pt2 = "touches" in ev ? (ev as TouchEvent).touches[0] : ev as MouseEvent
      const dx = (pt2.clientX - startX) / displayW
      const dy = (pt2.clientY - startY) / displayH

      setLayers(prev => {
        const l = { ...prev[id] }
        if (handle === "move") {
          l.x = Math.max(0, Math.min(1 - l.w, o.x + dx))
          l.y = Math.max(0, Math.min(1 - l.h, o.y + dy))
        } else {
          const minSize = 0.05
          if (handle.includes("l")) { const nx = Math.min(o.x + o.w - minSize, o.x + dx); l.x = Math.max(0, nx); l.w = o.w - (l.x - o.x) }
          if (handle.includes("r")) { l.w = Math.max(minSize, Math.min(1 - o.x, o.w + dx)) }
          if (handle.includes("t")) { const ny = Math.min(o.y + o.h - minSize, o.y + dy); l.y = Math.max(0, ny); l.h = o.h - (l.y - o.y) }
          if (handle.includes("b")) { l.h = Math.max(minSize, Math.min(1 - o.y, o.h + dy)) }
        }
        return { ...prev, [id]: l }
      })
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
  }, [layers, displayW, displayH, setLayers])

  return { startDrag }
}

// ── Crop drag (source region) ────────────────────────────────────────────
// The crop box is shown over the full background frame.
// Positions are in 0..1 relative to the background display (displayW x displayH),
// which we then convert to pixel coords in origW x origH.

function useCropDrag(
  layers: Record<string, Layer>,
  setLayers: React.Dispatch<React.SetStateAction<Record<string, Layer>>>,
  origW: number,
  origH: number,
  displayW: number,
  displayH: number,
) {
  const dragging = useRef<{
    id: string; handle: DragHandle
    startX: number; startY: number
    origSrcX: number; origSrcY: number; origSrcW: number; origSrcH: number
  } | null>(null)

  const startCropDrag = useCallback((e: React.MouseEvent | React.TouchEvent, id: string, handle: DragHandle) => {
    e.preventDefault(); e.stopPropagation()
    const pt = "touches" in e ? e.touches[0] : e
    const l = layers[id]
    dragging.current = { id, handle, startX: pt.clientX, startY: pt.clientY, origSrcX: l.srcX, origSrcY: l.srcY, origSrcW: l.srcW, origSrcH: l.srcH }

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!dragging.current) return
      const { id, handle, startX, startY, origSrcX: ox, origSrcY: oy, origSrcW: ow, origSrcH: oh } = dragging.current
      const pt2 = "touches" in ev ? (ev as TouchEvent).touches[0] : ev as MouseEvent
      // delta in original video pixels
      const ddx = ((pt2.clientX - startX) / displayW) * origW
      const ddy = ((pt2.clientY - startY) / displayH) * origH
      const minPx = 50

      setLayers(prev => {
        const l = { ...prev[id] }
        if (handle === "move") {
          l.srcX = Math.max(0, Math.min(origW - l.srcW, ox + ddx))
          l.srcY = Math.max(0, Math.min(origH - l.srcH, oy + ddy))
        } else {
          if (handle.includes("l")) {
            const nx = Math.min(ox + ow - minPx, ox + ddx)
            l.srcX = Math.max(0, nx)
            l.srcW = ow - (l.srcX - ox)
          }
          if (handle.includes("r")) { l.srcW = Math.max(minPx, Math.min(origW - ox, ow + ddx)) }
          if (handle.includes("t")) {
            const ny = Math.min(oy + oh - minPx, oy + ddy)
            l.srcY = Math.max(0, ny)
            l.srcH = oh - (l.srcY - oy)
          }
          if (handle.includes("b")) { l.srcH = Math.max(minPx, Math.min(origH - oy, oh + ddy)) }
        }
        return { ...prev, [id]: l }
      })
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
  }, [layers, origW, origH, displayW, displayH, setLayers])

  return { startCropDrag }
}

// ── CropBox: dashed box on the background frame showing the source crop ──
function CropBox({
  layer, color, origW, origH, displayW, displayH, onDragStart
}: {
  layer: Layer; color: string
  origW: number; origH: number; displayW: number; displayH: number
  onDragStart: (e: React.MouseEvent | React.TouchEvent, handle: DragHandle) => void
}) {
  if (!layer.visible || layer.srcW <= 0 || layer.srcH <= 0) return null

  // Convert src pixels → display pixels
  const px = (layer.srcX / origW) * displayW
  const py = (layer.srcY / origH) * displayH
  const pw = (layer.srcW / origW) * displayW
  const ph = (layer.srcH / origH) * displayH
  const HS = 18

  const handles: { h: DragHandle; cx: number; cy: number }[] = [
    { h: "tl", cx: px, cy: py },
    { h: "tr", cx: px + pw, cy: py },
    { h: "bl", cx: px, cy: py + ph },
    { h: "br", cx: px + pw, cy: py + ph },
  ]

  return (
    <>
      <div style={{
        position: "absolute", left: px, top: py, width: pw, height: ph,
        border: `2px dashed ${color}`,
        boxSizing: "border-box", cursor: "move",
        touchAction: "none", userSelect: "none",
        background: `${color}18`,
        zIndex: 5,
      }}
        onMouseDown={e => onDragStart(e, "move")}
        onTouchStart={e => onDragStart(e, "move")}
      >
        <span style={{
          position: "absolute", bottom: 3, right: 4, fontSize: 9, fontWeight: 700,
          color, background: "rgba(0,0,0,0.75)", padding: "1px 5px", borderRadius: 3,
          pointerEvents: "none", whiteSpace: "nowrap"
        }}>✂ RECORTE</span>
      </div>
      {handles.map(({ h, cx, cy }) => (
        <div key={h} style={{
          position: "absolute",
          left: cx - HS / 2, top: cy - HS / 2,
          width: HS, height: HS,
          background: color, border: "2px solid #000", borderRadius: 3,
          cursor: h === "tl" || h === "br" ? "nwse-resize" : "nesw-resize",
          touchAction: "none", zIndex: 15,
        }}
          onMouseDown={e => onDragStart(e, h)}
          onTouchStart={e => onDragStart(e, h)}
        />
      ))}
    </>
  )
}

// ── Layer element ────────────────────────────────────────────────────────

function LayerBox({
  layer, frameUrl, color, label, displayW, displayH,
  onDragStart, origW, origH
}: {
  layer: Layer; frameUrl: string; color: string; label: string
  displayW: number; displayH: number
  onDragStart: (e: React.MouseEvent | React.TouchEvent, handle: DragHandle) => void
  origW: number; origH: number
}) {
  if (!layer.visible) return null

  const px = layer.x * displayW
  const py = layer.y * displayH
  const pw = layer.w * displayW
  const ph = layer.h * displayH
  const HS = 20

  // Crop the source frame into the box using background-image
  const bgSizeW = layer.srcW > 0 ? (origW / layer.srcW) * 100 : 100
  const bgSizeH = layer.srcH > 0 ? (origH / layer.srcH) * 100 : 100

  const handles: { h: DragHandle; cx: number; cy: number }[] = [
    { h: "tl", cx: px, cy: py },
    { h: "tr", cx: px + pw, cy: py },
    { h: "bl", cx: px, cy: py + ph },
    { h: "br", cx: px + pw, cy: py + ph },
  ]

  return (
    <>
      {/* Layer box */}
      <div
        style={{
          position: "absolute", left: px, top: py, width: pw, height: ph,
          border: `2px solid ${color}`,
          boxSizing: "border-box", cursor: "move", overflow: "hidden",
          touchAction: "none", userSelect: "none",
          backgroundImage: frameUrl ? `url(${frameUrl})` : undefined,
          backgroundSize: `${bgSizeW}% ${bgSizeH}%`,
          backgroundPosition: `-${(layer.srcX / layer.srcW) * pw}px -${(layer.srcY / layer.srcH) * ph}px`,
          backgroundRepeat: "no-repeat",
          backgroundColor: "#1a1a26",
          zIndex: 8,
        }}
        onMouseDown={e => onDragStart(e, "move")}
        onTouchStart={e => onDragStart(e, "move")}
      >
        <span style={{
          position: "absolute", top: 4, left: 4, fontSize: 10, fontWeight: 700,
          color, background: "rgba(0,0,0,0.7)", padding: "2px 6px", borderRadius: 4,
          pointerEvents: "none"
        }}>{label}</span>
      </div>
      {/* Corner handles */}
      {handles.map(({ h, cx, cy }) => (
        <div key={h} style={{
          position: "absolute",
          left: cx - HS / 2, top: cy - HS / 2,
          width: HS, height: HS,
          background: color, border: "2px solid #000", borderRadius: 4,
          cursor: h === "tl" || h === "br" ? "nwse-resize" : "nesw-resize",
          touchAction: "none", zIndex: 10
        }}
          onMouseDown={e => onDragStart(e, h)}
          onTouchStart={e => onDragStart(e, h)}
        />
      ))}
    </>
  )
}

// ── Download button (blob fetch para que funcione en iOS/móvil) ──────────

function DownloadButton({ url }: { url: string }) {
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = blobUrl
      a.download = "astroclip.mp4"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
    } catch {
      // fallback: abrir en nueva pestaña
      window.open(url, "_blank")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      style={{
        display: "block", width: "100%", textAlign: "center",
        background: downloading ? "#059669" : "#10b981", color: "#fff",
        borderRadius: 10, padding: "16px",
        fontWeight: 700, fontSize: 16, border: "none", cursor: "pointer"
      }}
    >
      {downloading ? "Descargando..." : "⬇ Descargar MP4"}
    </button>
  )
}

// ── Main page ────────────────────────────────────────────────────────────

export default function ClipEditorPage() {
  const { id, index } = useParams()
  const [, nav] = useLocation()
  const [clip, setClip] = useState<Clip | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderSecs, setRenderSecs] = useState(0)
  const [downloadUrl, setDownloadUrl] = useState("")
  const [error, setError] = useState("")
  const [frameBlobUrl, setFrameBlobUrl] = useState("")
  const [logoBlobUrl, setLogoBlobUrl] = useState("")
  const [cropMode, setCropMode] = useState<string | null>(null) // layer id being cropped
  const canvasRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [displayW, setDisplayW] = useState(270)
  const displayH = displayW * (CANVAS_H / CANVAS_W) // 9:16

  const origW = clip?.visual?.orig_w || 1920
  const origH = clip?.visual?.orig_h || 1080

  const [layers, setLayers] = useState<Record<string, Layer>>({
    face: { id: "face", visible: true, srcX: 0, srcY: 0, srcW: 500, srcH: 500, x: 0, y: 0, w: 1, h: 0.5 },
    diag: { id: "diag", visible: false, srcX: 0, srcY: 0, srcW: 1440, srcH: 1080, x: 0, y: 0.5, w: 1, h: 0.5 },
    logo: { id: "logo", visible: true, srcX: 0, srcY: 0, srcW: 0, srcH: 0, x: 0.7, y: 0.02, w: 0.25, h: 0.07 },
  })
  const [logoOpacity, setLogoOpacity] = useState(0.8)
  const [activeLayer, setActiveLayer] = useState<string | null>(null)

  const { startDrag } = useLayerDrag(canvasRef, layers, setLayers, displayW, displayH)
  const { startCropDrag } = useCropDrag(layers, setLayers, origW, origH, displayW, displayH)

  // Measure canvas width — fixed 9:16, max 320px wide
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        const maxW = Math.min(containerRef.current.offsetWidth, 320)
        setDisplayW(maxW)
      }
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  // Load job
  useEffect(() => {
    processorFetch(`/api/job/${id}`).then(r => r.json()).then(job => {
      const c: Clip = job.clips[Number(index)]
      setClip(c)
      const t = Math.round(c.start + (c.end - c.start) / 2)
      // Fetch frame blob
      processorFetch(`/api/frame/${id}?t=${t}`)
        .then(r => r.ok ? r.blob() : null)
        .then(blob => { if (blob) setFrameBlobUrl(URL.createObjectURL(blob)) })
        .catch(() => {})
      // Fetch logo blob
      processorFetch(`/api/logo`)
        .then(r => r.ok ? r.blob() : null)
        .then(blob => { if (blob) setLogoBlobUrl(URL.createObjectURL(blob)) })
        .catch(() => {})
      if (c?.visual) {
        const v = c.visual
        const pad = 80
        const fx = Math.max(0, v.face_x - v.face_w / 2 - pad)
        const fy = Math.max(0, v.face_y - v.face_h / 2 - pad)
        const fw = Math.min(v.orig_w - fx, v.face_w + pad * 2)
        const fh = Math.min(v.orig_h - fy, v.face_h + pad * 2)

        setLayers(prev => ({
          ...prev,
          face: { ...prev.face, srcX: Math.round(fx), srcY: Math.round(fy), srcW: Math.round(fw), srcH: Math.round(fh), visible: true },
          diag: { ...prev.diag, srcX: 0, srcY: 0, srcW: Math.round(v.orig_w * 0.75), srcH: v.orig_h, visible: v.has_diagram },
        }))
      }
    })
  }, [id, index])

  const handleRender = async () => {
    if (!clip) return
    setRendering(true); setError(""); setDownloadUrl(""); setRenderSecs(0)
    const timer = setInterval(() => setRenderSecs(s => s + 1), 1000)
    try {
      const face = layers.face
      const diag = layers.diag
      const logo = layers.logo

      const config = {
        job_id: id,
        clip_index: Number(index),
        face_crop_x: face.srcX, face_crop_y: face.srcY, face_crop_w: face.srcW, face_crop_h: face.srcH,
        face_dst_x: face.x, face_dst_y: face.y, face_dst_w: face.w, face_dst_h: face.h,
        face_visible: face.visible,
        diagram_crop_x: diag.srcX, diagram_crop_y: diag.srcY, diagram_crop_w: diag.srcW, diagram_crop_h: diag.srcH,
        diagram_dst_x: diag.x, diagram_dst_y: diag.y, diagram_dst_w: diag.w, diagram_dst_h: diag.h,
        diagram_visible: diag.visible,
        logo_dst_x: logo.x, logo_dst_y: logo.y, logo_dst_w: logo.w,
        logo_visible: logo.visible,
        logo_opacity: logoOpacity,
        layout: diag.visible ? "split" : "face_only",
        show_logo: logo.visible,
        logo_size: Math.round(logo.w * CANVAS_W),
        logo_x: logo.x > 0.5 ? "right" : "left",
        logo_y: logo.y < 0.4 ? "top" : "bottom",
      }

      // Start render (returns immediately)
      const r = await processorFetch(`/api/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      if (!r.ok) throw new Error(await r.text())
      const { render_id } = await r.json()

      // Poll status every 3s
      await new Promise<void>((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const sr = await processorFetch(`/api/render_status/${render_id}`)
            const st = await sr.json()
            if (st.status === "done") {
              clearInterval(poll)
              setDownloadUrl(`/api/processor${st.url}`)
              resolve()
            } else if (st.status === "error") {
              clearInterval(poll)
              reject(new Error(st.error || "Error al renderizar"))
            }
          } catch (e) { clearInterval(poll); reject(e) }
        }, 3000)
      })
    } catch (e: any) {
      setError(e.message || "Error al renderizar")
    } finally {
      clearInterval(timer)
      setRendering(false)
    }
  }

  if (!clip) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0a0a0f" }}>
      <span style={{ color: "#8888a0" }}>Cargando...</span>
    </div>
  )

  const layerDefs = [
    { id: "face", label: "👤 Cara", color: "#a855f7" },
    { id: "diag", label: "🔮 Presentación", color: "#f59e0b" },
    { id: "logo", label: "⭐ Logo", color: "#10b981" },
  ]

  return (
    <div style={{ background: "#0a0a0f", minHeight: "100vh", padding: "12px" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button onClick={() => nav(`/job/${id}`)} style={{
            background: "#1a1a26", border: "1px solid #2a2a3a", color: "#8888a0",
            borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13
          }}>← Volver</button>
          <div>
            <div style={{ color: "#f0f0f5", fontWeight: 700, fontSize: 15 }}>
              Clip #{Number(index) + 1}
            </div>
            <div style={{ color: "#55556a", fontSize: 11 }}>
              {Math.round(clip.end - clip.start)}s · Score {clip.score}
            </div>
          </div>
        </div>

        {/* Layer toggles */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {layerDefs.map(({ id: lid, label, color }) => (
            <button key={lid}
              onClick={() => {
                setLayers(p => ({ ...p, [lid]: { ...p[lid], visible: !p[lid].visible } }))
                setActiveLayer(lid)
                setCropMode(null)
              }}
              style={{
                padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13,
                border: `2px solid ${layers[lid].visible ? color : "#2a2a3a"}`,
                background: layers[lid].visible ? `${color}22` : "#1a1a26",
                color: layers[lid].visible ? color : "#55556a", fontWeight: 600,
              }}>{label}</button>
          ))}
        </div>

        {/* Crop mode toggle — only for face/diag */}
        {activeLayer && activeLayer !== "logo" && layers[activeLayer]?.visible && (
          <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setCropMode(cropMode === activeLayer ? null : activeLayer)}
              style={{
                padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12,
                border: `2px solid ${cropMode === activeLayer ? "#ef4444" : "#2a2a3a"}`,
                background: cropMode === activeLayer ? "#ef444422" : "#1a1a26",
                color: cropMode === activeLayer ? "#ef4444" : "#8888a0", fontWeight: 600,
              }}
            >
              {cropMode === activeLayer ? "✂ Modo recorte activo" : "✂ Ajustar recorte fuente"}
            </button>
            {cropMode === activeLayer && (
              <span style={{ color: "#55556a", fontSize: 11 }}>
                Arrastra el cuadro punteado sobre el frame
              </span>
            )}
          </div>
        )}

        {/* 9:16 Canvas */}
        <div ref={containerRef} style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #1a1a26" }}>
            <span style={{ color: "#55556a", fontSize: 11, fontFamily: "JetBrains Mono" }}>
              {cropMode ? "✂ MODO RECORTE — arrastra el cuadro punteado" : "ARRASTRA Y REDIMENSIONA CADA CAPA · 9:16"}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "center", background: "#0a0a0f", padding: "8px 0" }}>
          <div
            ref={canvasRef}
            style={{
              position: "relative",
              width: displayW,
              height: displayH,
              background: "#000",
              overflow: "hidden",
              touchAction: "none",
              flexShrink: 0,
            }}
            onClick={() => { if (!cropMode) setActiveLayer(null) }}
          >
            {/* Background frame */}
            {frameBlobUrl && (
              <img
                src={frameBlobUrl}
                alt=""
                style={{
                  position: "absolute", inset: 0, width: "100%", height: "100%",
                  objectFit: "cover", opacity: cropMode ? 0.85 : 0.5, pointerEvents: "none",
                  zIndex: 1,
                }}
              />
            )}
            {!frameBlobUrl && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
                <span style={{ color: "#55556a", fontSize: 12 }}>Cargando frame...</span>
              </div>
            )}

            {/* CROP MODE: show crop box over background, hide dest layers */}
            {cropMode && cropMode !== "logo" && (() => {
              const def = layerDefs.find(d => d.id === cropMode)!
              const layer = layers[cropMode]
              return (
                <CropBox
                  layer={layer}
                  color={def.color}
                  origW={origW}
                  origH={origH}
                  displayW={displayW}
                  displayH={displayH}
                  onDragStart={(e, handle) => startCropDrag(e, cropMode, handle)}
                />
              )
            })()}

            {/* DEST MODE: show dest layer boxes */}
            {!cropMode && (
              <>
                {layerDefs.filter(l => l.id !== "logo").map(({ id: lid, label, color }) => (
                  <LayerBox
                    key={lid}
                    layer={layers[lid]}
                    frameUrl={frameBlobUrl}
                    color={color}
                    label={label}
                    displayW={displayW}
                    displayH={displayH}
                    origW={origW}
                    origH={origH}
                    onDragStart={(e, handle) => {
                      setActiveLayer(lid)
                      startDrag(e, lid, handle)
                    }}
                  />
                ))}

                {/* Logo layer */}
                {layers.logo.visible && (() => {
                  const l = layers.logo
                  const lpx = l.x * displayW, lpy = l.y * displayH
                  const lpw = l.w * displayW, lph = l.h * displayH
                  const HS = 20
                  const handles: { h: DragHandle; cx: number; cy: number }[] = [
                    { h: "tl", cx: lpx, cy: lpy }, { h: "tr", cx: lpx + lpw, cy: lpy },
                    { h: "bl", cx: lpx, cy: lpy + lph }, { h: "br", cx: lpx + lpw, cy: lpy + lph },
                  ]
                  return (
                    <>
                      <div style={{
                        position: "absolute", left: lpx, top: lpy, width: lpw, height: lph,
                        border: "2px solid #10b981", background: "rgba(16,185,129,0.15)",
                        cursor: "move", touchAction: "none", boxSizing: "border-box",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        zIndex: 8,
                      }}
                        onMouseDown={e => { setActiveLayer("logo"); startDrag(e, "logo", "move") }}
                        onTouchStart={e => { setActiveLayer("logo"); startDrag(e, "logo", "move") }}
                      >
                        {logoBlobUrl
                          ? <img src={logoBlobUrl} style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", opacity: logoOpacity }} />
                          : <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700, pointerEvents: "none" }}>LOGO</span>
                        }
                      </div>
                      {handles.map(({ h, cx, cy }) => (
                        <div key={h} style={{
                          position: "absolute", left: cx - HS / 2, top: cy - HS / 2,
                          width: HS, height: HS, background: "#10b981", border: "2px solid #000",
                          borderRadius: 4, cursor: h === "tl" || h === "br" ? "nwse-resize" : "nesw-resize",
                          touchAction: "none", zIndex: 10
                        }}
                          onMouseDown={e => { setActiveLayer("logo"); startDrag(e, "logo", h) }}
                          onTouchStart={e => { setActiveLayer("logo"); startDrag(e, "logo", h) }}
                        />
                      ))}
                    </>
                  )
                })()}
              </>
            )}
          </div>
          </div>
        </div>

        {/* Logo opacity */}
        {layers.logo.visible && (
          <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <p style={{ color: "#55556a", fontSize: 11, margin: "0 0 8px", fontFamily: "JetBrains Mono" }}>
              OPACIDAD LOGO: {Math.round(logoOpacity * 100)}%
            </p>
            <input type="range" min={10} max={100} value={Math.round(logoOpacity * 100)}
              onChange={e => setLogoOpacity(Number(e.target.value) / 100)}
              style={{ width: "100%", accentColor: "#10b981" }} />
          </div>
        )}

        {/* Caption */}
        {clip.tiktok_caption && (
          <div style={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <p style={{ color: "#55556a", fontSize: 11, fontFamily: "JetBrains Mono", margin: "0 0 8px" }}>
              DESCRIPCIÓN TIKTOK
            </p>
            <p style={{ color: "#f0f0f5", fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
              {clip.tiktok_caption}
            </p>
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
          {rendering ? `⏳ Renderizando... ${renderSecs}s` : "🎬 Generar clip"}
        </button>
        {rendering && (
          <p style={{ color: "#55556a", fontSize: 12, textAlign: "center", margin: "0 0 10px" }}>
            Un clip de {Math.round(clip.end - clip.start)}s tarda ~{Math.round((clip.end - clip.start) * 0.5)}s. No cierres la página.
          </p>
        )}

        {error && (
          <p style={{ color: "#ef4444", fontSize: 13, textAlign: "center", marginBottom: 10 }}>⚠ {error}</p>
        )}

        {downloadUrl && (
          <DownloadButton url={downloadUrl} />
        )}

      </div>
    </div>
  )
}

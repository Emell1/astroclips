import { useState, useCallback } from "react"
import { useLocation } from "wouter"

import { getToken, processorFetch } from "../lib/auth"

export default function UploadPage() {
  const [, nav] = useLocation()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState("")
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [loadingUrl, setLoadingUrl] = useState(false)

  const uploadFile = async (file: File) => {
    setUploading(true)
    setError("")
    setProgress(0)

    const formData = new FormData()
    formData.append("file", file)

    try {
      const token = getToken()
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
      }

      const result = await new Promise<{ job_id: string }>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) resolve(JSON.parse(xhr.responseText))
          else reject(new Error(xhr.responseText))
        }
        xhr.onerror = () => reject(new Error("Error de red"))
        xhr.open("POST", `/api/processor/api/upload`)
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)
        xhr.send(formData)
      })

      nav(`/job/${result.job_id}`)
    } catch (e: any) {
      setError(e.message || "Error al subir el video")
      setUploading(false)
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith("video/")) uploadFile(file)
    else setError("Solo se aceptan archivos de video")
  }, [])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
  }

  const submitYoutubeUrl = async () => {
    if (!youtubeUrl.trim()) return
    setLoadingUrl(true)
    setError("")
    try {
      const res = await processorFetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      nav(`/job/${data.job_id}`)
    } catch (e: any) {
      setError(e.message || "Error al procesar la URL")
      setLoadingUrl(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-6"
          style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)" }}>
          <span style={{ color: "#7c3aed", fontSize: 12, fontFamily: "JetBrains Mono" }}>✦ BETA</span>
        </div>
        <h1 className="text-5xl font-bold mb-3" style={{ fontFamily: "Syne", color: "#f0f0f5" }}>
          Astro<span style={{ color: "#7c3aed" }}>Clips</span>
        </h1>
        <p style={{ color: "#8888a0", fontSize: 16, maxWidth: 420, margin: "0 auto" }}>
          Sube una clase de astrología y detecta automáticamente los mejores clips para TikTok
        </p>
      </div>

      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={{
          width: "100%", maxWidth: 560,
          border: `2px dashed ${dragging ? "#7c3aed" : "#2a2a3a"}`,
          borderRadius: 16,
          background: dragging ? "rgba(124,58,237,0.08)" : "#12121a",
          padding: "48px 32px",
          textAlign: "center",
          transition: "all 0.2s",
          cursor: "pointer",
        }}
        onClick={() => !uploading && document.getElementById("file-input")?.click()}
      >
        <input id="file-input" type="file" accept="video/*" style={{ display: "none" }} onChange={onFileChange} />

        {uploading ? (
          <div>
            <div className="text-4xl mb-4">⏫</div>
            <p style={{ color: "#f0f0f5", fontWeight: 600, marginBottom: 12 }}>Subiendo video...</p>
            <div style={{ background: "#1a1a26", borderRadius: 8, height: 8, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 8,
                background: "linear-gradient(90deg, #7c3aed, #a855f7)",
                width: `${progress}%`, transition: "width 0.3s"
              }} />
            </div>
            <p style={{ color: "#8888a0", fontSize: 13, marginTop: 8 }}>{progress}%</p>
          </div>
        ) : (
          <div>
            <div className="text-5xl mb-5">🎬</div>
            <p style={{ color: "#f0f0f5", fontWeight: 600, fontSize: 18, marginBottom: 8 }}>
              Arrastra tu video aquí
            </p>
            <p style={{ color: "#8888a0", fontSize: 14, marginBottom: 20 }}>
              o haz clic para seleccionar
            </p>
            <div style={{
              display: "inline-block", padding: "10px 24px", borderRadius: 8,
              background: "#7c3aed", color: "#fff", fontWeight: 600, fontSize: 14
            }}>
              Seleccionar video
            </div>
            <p style={{ color: "#55556a", fontSize: 12, marginTop: 16 }}>
              MP4, MOV, AVI · Máx 120 minutos
            </p>
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", maxWidth: 560, marginTop: 24 }}>
        <div style={{ flex: 1, height: 1, background: "#2a2a3a" }} />
        <span style={{ color: "#55556a", fontSize: 13 }}>o pega un link de YouTube</span>
        <div style={{ flex: 1, height: 1, background: "#2a2a3a" }} />
      </div>

      {/* YouTube URL input */}
      <div style={{ width: "100%", maxWidth: 560, marginTop: 16, display: "flex", gap: 10 }}>
        <input
          type="url"
          placeholder="https://youtube.com/watch?v=..."
          value={youtubeUrl}
          onChange={e => setYoutubeUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submitYoutubeUrl()}
          disabled={uploading || loadingUrl}
          style={{
            flex: 1,
            background: "#12121a",
            border: "1px solid #2a2a3a",
            borderRadius: 8,
            padding: "10px 14px",
            color: "#f0f0f5",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          onClick={submitYoutubeUrl}
          disabled={uploading || loadingUrl || !youtubeUrl.trim()}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            background: youtubeUrl.trim() && !loadingUrl ? "#7c3aed" : "#2a2a3a",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            border: "none",
            cursor: youtubeUrl.trim() && !loadingUrl ? "pointer" : "not-allowed",
            transition: "background 0.2s",
            whiteSpace: "nowrap",
          }}
        >
          {loadingUrl ? "Procesando..." : "Analizar"}
        </button>
      </div>

      {error && (
        <p style={{ color: "#ef4444", marginTop: 16, fontSize: 14 }}>⚠ {error}</p>
      )}

      {/* Features */}
      <div style={{ display: "flex", gap: 16, marginTop: 48, flexWrap: "wrap", justifyContent: "center" }}>
        {[
          { icon: "🔍", label: "Detecta clips virales" },
          { icon: "🧠", label: "IA con Groq Llama 3" },
          { icon: "✂️", label: "Editor de recorte" },
          { icon: "📱", label: "Export 9:16 TikTok" },
        ].map(f => (
          <div key={f.label} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 16px", borderRadius: 8,
            background: "#12121a", border: "1px solid #2a2a3a",
            color: "#8888a0", fontSize: 13
          }}>
            <span>{f.icon}</span>
            <span>{f.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

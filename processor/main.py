#!/usr/bin/env python3
"""
AstroClips Processor — FastAPI backend
Handles video processing: transcription, viral detection, clip extraction, editing
"""

import os
import json
import uuid
import shutil
import asyncio
import subprocess
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from faster_whisper import WhisperModel
from groq import Groq

# ── Config ────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
DATA_DIR    = Path(os.environ.get("DATA_DIR", str(BASE_DIR)))
UPLOADS_DIR = DATA_DIR / "uploads"
OUTPUTS_DIR = DATA_DIR / "outputs"
JOBS_DIR    = DATA_DIR / "jobs"
LOGO_PATH   = Path(os.environ.get("LOGO_PATH", str(BASE_DIR / "logo.jpg")))

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
TIKTOK_W, TIKTOK_H = 1080, 1920

for d in [UPLOADS_DIR, OUTPUTS_DIR, JOBS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ── App ───────────────────────────────────────────────────────────────────
app = FastAPI(title="AstroClips Processor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Serve outputs as static files
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")

# ── Job State ─────────────────────────────────────────────────────────────
def save_job(job_id: str, data: dict):
    with open(JOBS_DIR / f"{job_id}.json", "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_job(job_id: str) -> dict:
    p = JOBS_DIR / f"{job_id}.json"
    if not p.exists():
        raise HTTPException(404, "Job not found")
    with open(p) as f:
        return json.load(f)

def update_job(job_id: str, **kwargs):
    data = load_job(job_id)
    data.update(kwargs)
    save_job(job_id, data)

# ── Video Analysis ────────────────────────────────────────────────────────

def get_video_info(path: Path) -> dict:
    result = subprocess.run([
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", "-show_format", str(path)
    ], capture_output=True, text=True)
    if not result.stdout.strip():
        raise RuntimeError(f"ffprobe failed (returncode={result.returncode}): {result.stderr.strip()}")
    info = json.loads(result.stdout)
    duration = float(info["format"]["duration"])
    vs = next((s for s in info["streams"] if s["codec_type"] == "video"), {})
    w = int(vs.get("width", 1920))
    h = int(vs.get("height", 1080))
    return {"duration": duration, "width": w, "height": h}


def extract_audio(video_path: Path, audio_path: Path):
    subprocess.run([
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        str(audio_path)
    ], capture_output=True)


def transcribe(audio_path: Path) -> list:
    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(
        str(audio_path), language="es",
        vad_filter=True,
        word_timestamps=False,
        vad_parameters=dict(min_silence_duration_ms=500)
    )
    return [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]


def group_into_clips(segments: list, max_dur=90, min_dur=20) -> list:
    """Group segments into candidate clips of up to max_dur seconds."""
    clips = []
    if not segments:
        return clips

    cur = {"start": segments[0]["start"], "end": segments[0]["end"], "text": segments[0]["text"], "segments": [segments[0]]}
    for seg in segments[1:]:
        if seg["end"] - cur["start"] <= max_dur:
            cur["end"] = seg["end"]
            cur["text"] += " " + seg["text"]
            cur["segments"].append(seg)
        else:
            if cur["end"] - cur["start"] >= min_dur:
                clips.append(cur)
            cur = {"start": seg["start"], "end": seg["end"], "text": seg["text"], "segments": [seg]}

    if cur["end"] - cur["start"] >= min_dur:
        clips.append(cur)

    return clips


def score_clips_with_groq(clips: list) -> list:
    """Use Groq Llama to score and describe each clip."""
    if not GROQ_API_KEY:
        # Fallback: heuristic scoring
        for clip in clips:
            clip["score"] = _heuristic_score(clip["text"])
            clip["why"] = "Scoring heurístico (sin API key)"
            clip["tiktok_caption"] = f"🔮 {clip['text'][:80]}...\n\n#astrologia #antonioescoriza #astrologianeoclasica"
        return clips

    client = Groq(api_key=GROQ_API_KEY)

    for clip in clips:
        text = clip["text"][:800]
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{
                    "role": "user",
                    "content": f"""Eres experto en contenido viral de TikTok de astrología en español de España.

Analiza este fragmento de una clase de astrología y responde en JSON:
{{
  "score": <número 0-100 de potencial viral>,
  "why": "<en 1 frase por qué es viral o interesante>",
  "tiktok_caption": "<descripción viral para TikTok, máx 150 chars, con emojis y hashtags>"
}}

Fragmento: "{text}"

Solo responde con el JSON, sin texto adicional."""
                }],
                temperature=0.7,
                max_tokens=300,
            )
            raw = response.choices[0].message.content.strip()
            # Extract JSON
            start = raw.find("{")
            end = raw.rfind("}") + 1
            parsed = json.loads(raw[start:end])
            clip["score"] = parsed.get("score", 50)
            clip["why"] = parsed.get("why", "")
            clip["tiktok_caption"] = parsed.get("tiktok_caption", "")
        except Exception as e:
            clip["score"] = _heuristic_score(text)
            clip["why"] = f"Error Groq: {e}"
            clip["tiktok_caption"] = f"🔮 Astrología con Antonio Escoriza\n\n#astrologia #antonioescoriza"

    return clips


def _heuristic_score(text: str) -> int:
    score = 0
    kw = ["nunca","secreto","verdad","importante","clave","increíble","brutal",
          "karma","destino","amor","dinero","marte","venus","saturno","luna",
          "ascendente","carta natal","signo","plutón","neptuno","cuadratura",
          "oposición","nadie sabe","la mayoría","casi nadie","te van a","¿sabes"]
    t = text.lower()
    for k in kw:
        if k in t: score += 6
    if "?" in text: score += 10
    if "!" in text: score += 5
    wc = len(text.split())
    if 30 <= wc <= 200: score += 15
    return min(score, 100)


def detect_face_and_diagram(video_path: Path, start: float, end: float) -> dict:
    """
    Sample frames in segment. Detect:
    - Face presence and position (Antonio's thumbnail, top-right of Zoom)
    - Astrological diagram (circles/wheel in main area)
    Returns: {has_face, face_x, face_y, face_w, face_h, has_diagram, face_ratio, diagram_ratio}
    """
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    face_frames = 0
    diagram_frames = 0
    total = 0
    face_positions = []

    t = start
    step = max(2.0, (end - start) / 15)  # max 15 samples
    while t < end:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
        ret, frame = cap.read()
        if not ret:
            break
        total += 1

        # Face detection
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(40, 40))
        if len(faces) > 0:
            face_frames += 1
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            face_positions.append((x + fw // 2, y + fh // 2, fw, fh))

        # Diagram detection — look for circles in center-left area (presentation area)
        # Zoom layout: presentation on left ~80%, face top-right ~20%
        center_area = frame[:, :int(orig_w * 0.75)]
        gray_center = cv2.cvtColor(center_area, cv2.COLOR_BGR2GRAY)
        gray_blur = cv2.GaussianBlur(gray_center, (9, 9), 2)
        circles = cv2.HoughCircles(
            gray_blur, cv2.HOUGH_GRADIENT, dp=1.2,
            minDist=int(orig_h * 0.1),
            param1=80, param2=40,
            minRadius=int(orig_h * 0.08),
            maxRadius=int(orig_h * 0.45)
        )
        if circles is not None and len(circles[0]) >= 1:
            diagram_frames += 1

        t += step

    cap.release()

    if total == 0:
        return {"has_face": False, "face_ratio": 0, "has_diagram": False, "diagram_ratio": 0,
                "face_x": 0, "face_y": 0, "face_w": 0, "face_h": 0,
                "orig_w": orig_w, "orig_h": orig_h}

    has_face = face_frames / total > 0.3
    has_diagram = diagram_frames / total > 0.3

    avg_x = int(np.mean([p[0] for p in face_positions])) if face_positions else int(orig_w * 0.9)
    avg_y = int(np.mean([p[1] for p in face_positions])) if face_positions else int(orig_h * 0.1)
    avg_w = int(np.mean([p[2] for p in face_positions])) if face_positions else 200
    avg_h = int(np.mean([p[3] for p in face_positions])) if face_positions else 200

    return {
        "has_face": has_face,
        "face_ratio": round(face_frames / total, 2),
        "has_diagram": has_diagram,
        "diagram_ratio": round(diagram_frames / total, 2),
        "face_x": avg_x,
        "face_y": avg_y,
        "face_w": avg_w,
        "face_h": avg_h,
        "orig_w": orig_w,
        "orig_h": orig_h,
    }


# ── Clip Rendering ────────────────────────────────────────────────────────

class RenderConfig(BaseModel):
    job_id: str
    clip_index: int
    # Face source crop (original video pixels)
    face_crop_x: int = 0
    face_crop_y: int = 0
    face_crop_w: int = 500
    face_crop_h: int = 500
    # Face dest on canvas (0..1)
    face_dst_x: float = 0
    face_dst_y: float = 0
    face_dst_w: float = 1
    face_dst_h: float = 0.5
    face_visible: bool = True
    # Diagram source crop
    diagram_crop_x: Optional[int] = None
    diagram_crop_y: Optional[int] = None
    diagram_crop_w: Optional[int] = None
    diagram_crop_h: Optional[int] = None
    # Diagram dest on canvas (0..1)
    diagram_dst_x: float = 0
    diagram_dst_y: float = 0.5
    diagram_dst_w: float = 1
    diagram_dst_h: float = 0.5
    diagram_visible: bool = False
    # Logo dest on canvas (0..1)
    logo_dst_x: float = 0.7
    logo_dst_y: float = 0.02
    logo_dst_w: float = 0.25
    logo_visible: bool = True
    logo_opacity: float = 0.8
    # Legacy compat
    layout: str = "face_only"
    show_logo: bool = True
    logo_size: int = 130
    logo_x: str = "right"
    logo_y: str = "top"


def render_clip(video_path: str, start: float, duration: float,
                config: RenderConfig, output_path: Path) -> bool:
    """Render using canvas-based layout: each layer has src crop + dst position on 1080x1920."""
    vp = Path(video_path)
    logo_path = str(LOGO_PATH) if LOGO_PATH.exists() else None

    W, H = 1080, 1920  # output canvas

    filters = []
    inputs = ["ffmpeg", "-y", "-ss", str(start), "-t", str(duration), "-i", str(vp)]
    logo_input_idx = None

    if logo_path and config.logo_visible:
        inputs += ["-i", logo_path]
        logo_input_idx = 1

    # Black canvas base
    filters.append(f"color=black:{W}x{H}:r=30[canvas]")
    current = "canvas"

    # ── Face layer ──
    if config.face_visible:
        fx, fy = config.face_crop_x, config.face_crop_y
        fw, fh = config.face_crop_w, config.face_crop_h
        # dest in pixels
        dx = int(config.face_dst_x * W)
        dy = int(config.face_dst_y * H)
        dw = int(config.face_dst_w * W)
        dh = int(config.face_dst_h * H)
        filters.append(
            f"[0:v]crop={fw}:{fh}:{fx}:{fy},"
            f"scale={dw}:{dh}:force_original_aspect_ratio=decrease,"
            f"pad={dw}:{dh}:(ow-iw)/2:(oh-ih)/2:black[face_l]"
        )
        filters.append(f"[{current}][face_l]overlay={dx}:{dy}[after_face]")
        current = "after_face"

    # ── Diagram layer ──
    if config.diagram_visible and config.diagram_crop_w:
        dx2 = int(config.diagram_dst_x * W)
        dy2 = int(config.diagram_dst_y * H)
        dw2 = int(config.diagram_dst_w * W)
        dh2 = int(config.diagram_dst_h * H)
        filters.append(
            f"[0:v]crop={config.diagram_crop_w}:{config.diagram_crop_h}:{config.diagram_crop_x}:{config.diagram_crop_y},"
            f"scale={dw2}:{dh2}:force_original_aspect_ratio=decrease,"
            f"pad={dw2}:{dh2}:(ow-iw)/2:(oh-ih)/2:black[diag_l]"
        )
        filters.append(f"[{current}][diag_l]overlay={dx2}:{dy2}[after_diag]")
        current = "after_diag"

    # ── Logo layer ──
    if logo_path and config.logo_visible and logo_input_idx is not None:
        lx = int(config.logo_dst_x * W)
        ly = int(config.logo_dst_y * H)
        lw = int(config.logo_dst_w * W)
        filters.append(
            f"[{logo_input_idx}:v]scale={lw}:-1,"
            f"format=rgba,colorchannelmixer=aa={config.logo_opacity}[logo_l]"
        )
        filters.append(f"[{current}][logo_l]overlay={lx}:{ly}[after_logo]")
        current = "after_logo"

    filter_complex = ";".join(filters)

    cmd = inputs + [
        "-filter_complex", filter_complex,
        "-map", f"[{current}]", "-map", "0:a",
        "-c:v", "libx264", "-crf", "23", "-preset", "ultrafast",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("ffmpeg error:", result.stderr[-1000:])
        return False
    return True


# ── Background Processing ─────────────────────────────────────────────────

async def process_video_job(job_id: str, video_path: Path):
    try:
        update_job(job_id, status="analyzing", progress=5, step="Obteniendo info del video...")
        info = get_video_info(video_path)
        update_job(job_id, video_info=info, progress=10)

        # Transcribe
        update_job(job_id, step="Transcribiendo audio con Whisper...", progress=15)
        audio_path = video_path.with_suffix(".wav")
        extract_audio(video_path, audio_path)
        update_job(job_id, progress=25, step="Transcripción en proceso...")

        segments = await asyncio.get_event_loop().run_in_executor(None, transcribe, audio_path)
        audio_path.unlink(missing_ok=True)
        update_job(job_id, progress=45, step=f"Transcripción completa ({len(segments)} segmentos). Agrupando clips...")

        # Group into clips
        clips = group_into_clips(segments, max_dur=90, min_dur=20)
        update_job(job_id, progress=50, step=f"{len(clips)} clips candidatos. Analizando con IA...")

        # Score with Groq
        clips = await asyncio.get_event_loop().run_in_executor(None, score_clips_with_groq, clips)
        # Sort by score descending
        clips.sort(key=lambda x: x["score"], reverse=True)
        # Keep top 20
        clips = clips[:20]
        update_job(job_id, progress=65, step="Detectando cara y diagramas en clips...")

        # Detect face + diagram
        for i, clip in enumerate(clips):
            visual = await asyncio.get_event_loop().run_in_executor(
                None, detect_face_and_diagram, video_path, clip["start"], clip["end"]
            )
            clip["visual"] = visual
            clip["id"] = i
            update_job(job_id, progress=65 + int((i+1)/len(clips)*25),
                      step=f"Analizando clip {i+1}/{len(clips)}...")

        update_job(job_id,
                   status="done",
                   progress=100,
                   step="¡Análisis completo!",
                   clips=clips,
                   video_path=str(video_path))

    except Exception as e:
        update_job(job_id, status="error", error=str(e), step=f"Error: {e}")
        raise


# ── API Routes ────────────────────────────────────────────────────────────

@app.post("/api/upload")
async def upload_video(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    job_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix or ".mp4"
    video_path = UPLOADS_DIR / f"{job_id}{ext}"

    with open(video_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    size_mb = video_path.stat().st_size / (1024 * 1024)

    save_job(job_id, {
        "id": job_id,
        "filename": file.filename,
        "size_mb": round(size_mb, 1),
        "status": "uploaded",
        "progress": 0,
        "step": "Video subido. Iniciando análisis...",
        "clips": [],
        "video_path": str(video_path),
    })

    background_tasks.add_task(process_video_job, job_id, video_path)
    return {"job_id": job_id}


@app.get("/api/job/{job_id}")
async def get_job(job_id: str):
    return load_job(job_id)


@app.post("/api/render")
async def render_clip_endpoint(config: RenderConfig):
    job = load_job(config.job_id)
    clips = job.get("clips", [])

    if config.clip_index >= len(clips):
        raise HTTPException(400, "Clip index out of range")

    clip = clips[config.clip_index]
    video_path = job["video_path"]
    start = clip["start"]
    duration = clip["end"] - clip["start"]

    out_name = f"{config.job_id}_clip{config.clip_index}.mp4"
    output_path = OUTPUTS_DIR / out_name

    success = render_clip(video_path, start, duration, config, output_path)
    if not success:
        raise HTTPException(500, "Error al renderizar el clip")

    return {"url": f"/api/download/{out_name}", "filename": out_name}


@app.get("/api/download/{filename}")
async def download_file(filename: str):
    p = OUTPUTS_DIR / filename
    if not p.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(str(p), media_type="video/mp4", filename=filename)


@app.get("/api/frame/{job_id}")
async def get_frame(job_id: str, t: float = 0):
    job = load_job(job_id)
    video_path = Path(job["video_path"])
    frame_path = OUTPUTS_DIR / f"{job_id}_frame.jpg"
    if not frame_path.exists():
        subprocess.run([
            "ffmpeg", "-y", "-ss", str(t), "-i", str(video_path),
            "-vframes", "1", "-q:v", "3", "-vf", "scale=1280:-1",
            str(frame_path)
        ], capture_output=True)
    if not frame_path.exists():
        raise HTTPException(404, "Frame not found")
    return FileResponse(str(frame_path), media_type="image/jpeg")


@app.get("/api/health")
async def health():
    return {"status": "ok", "groq": bool(GROQ_API_KEY)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)

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
import time
from pathlib import Path
from typing import Optional

import tempfile
import boto3
from botocore.config import Config as BotoConfig
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

# ── R2 Config ─────────────────────────────────────────────────────────────
R2_ACCOUNT_ID      = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID   = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET          = os.environ.get("R2_BUCKET", "astroclips")
R2_ENABLED = bool(R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY)

def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=BotoConfig(signature_version="s3v4"),
        region_name="auto",
    )

def r2_upload(local_path: Path, key: str):
    """Upload a file to R2."""
    if not R2_ENABLED:
        return
    client = _r2_client()
    client.upload_file(str(local_path), R2_BUCKET, key)
    print(f"[R2] uploaded {key}")

def r2_download(key: str, local_path: Path):
    """Download a file from R2 to local_path."""
    if not R2_ENABLED:
        raise FileNotFoundError(f"R2 not configured, cannot fetch {key}")
    client = _r2_client()
    local_path.parent.mkdir(parents=True, exist_ok=True)
    client.download_file(R2_BUCKET, key, str(local_path))
    print(f"[R2] downloaded {key}")

def r2_exists(key: str) -> bool:
    """Check if a key exists in R2."""
    if not R2_ENABLED:
        return False
    try:
        _r2_client().head_object(Bucket=R2_BUCKET, Key=key)
        return True
    except Exception:
        return False

def ensure_video_local(job_id: str, job: dict) -> Path:
    """Make sure the video is available locally. Download from R2 if needed."""
    # Try stored path first
    stored = Path(job.get("video_path", ""))
    if stored.exists():
        return stored
    # Try R2
    r2_key = job.get("r2_key", f"uploads/{job_id}.mp4")
    local = UPLOADS_DIR / f"{job_id}.mp4"
    if local.exists():
        return local
    r2_download(r2_key, local)
    return local

for d in [UPLOADS_DIR, OUTPUTS_DIR, JOBS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ── App ───────────────────────────────────────────────────────────────────
app = FastAPI(title="AstroClips Processor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Serve outputs as static files
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")

# ── Database ──────────────────────────────────────────────────────────────
_DATABASE_URL = os.environ.get("DATABASE_URL")
_pg_conn = None  # module-level connection (reconnect on error)

def _get_pg():
    global _pg_conn
    if _pg_conn is None or _pg_conn.closed:
        import psycopg2
        _pg_conn = psycopg2.connect(_DATABASE_URL)
        _pg_conn.autocommit = True
    return _pg_conn

def init_db():
    if not _DATABASE_URL:
        print("[DB] No DATABASE_URL — using disk persistence")
        return
    try:
        conn = _get_pg()
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL,
                    updated_at BIGINT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS render_jobs (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL,
                    updated_at BIGINT NOT NULL
                )
            """)
        print("[DB] PostgreSQL tables ready")
    except Exception as e:
        print(f"[DB] init_db error: {e}")

# ── Job State ─────────────────────────────────────────────────────────────
def save_job(job_id: str, data: dict):
    if _DATABASE_URL:
        try:
            conn = _get_pg()
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO jobs (id, data, updated_at)
                       VALUES (%s, %s::jsonb, %s)
                       ON CONFLICT (id) DO UPDATE
                       SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at""",
                    (job_id, json.dumps(data, ensure_ascii=False), int(time.time()))
                )
            return
        except Exception as e:
            print(f"[DB] save_job pg error: {e} — falling back to disk")
    # disk fallback
    with open(JOBS_DIR / f"{job_id}.json", "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_job(job_id: str) -> dict:
    if _DATABASE_URL:
        try:
            conn = _get_pg()
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM jobs WHERE id = %s", (job_id,))
                row = cur.fetchone()
            if row:
                return row[0] if isinstance(row[0], dict) else json.loads(row[0])
            raise HTTPException(404, "Job not found")
        except HTTPException:
            raise
        except Exception as e:
            print(f"[DB] load_job pg error: {e} — falling back to disk")
    # disk fallback
    p = JOBS_DIR / f"{job_id}.json"
    if not p.exists():
        raise HTTPException(404, "Job not found")
    with open(p) as f:
        return json.load(f)

def update_job(job_id: str, **kwargs):
    data = load_job(job_id)
    data.update(kwargs)
    save_job(job_id, data)

init_db()

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


def group_into_clips(segments: list, max_dur=90, min_dur=15) -> list:
    """
    Group segments into clips based on natural speech pauses.
    Strategy: find self-contained ideas (sentence-level) up to max_dur.
    Prefer clips of 15-60s. Never cut mid-sentence.
    """
    clips = []
    if not segments:
        return clips

    def flush(cur):
        dur = cur["end"] - cur["start"]
        if dur >= min_dur:
            clips.append(cur)

    cur = None
    for seg in segments:
        seg_dur = seg["end"] - seg["start"]
        text = seg["text"].strip()

        if cur is None:
            cur = {"start": seg["start"], "end": seg["end"], "text": text, "segments": [seg]}
            continue

        would_be_dur = seg["end"] - cur["start"]

        # Detect natural break: segment ends with sentence-ending punctuation
        ends_sentence = text and text[-1] in ".!?…"
        cur_ends_sentence = cur["text"] and cur["text"][-1] in ".!?…"

        if would_be_dur > max_dur:
            # Must cut — flush current and start new
            flush(cur)
            cur = {"start": seg["start"], "end": seg["end"], "text": text, "segments": [seg]}
        elif would_be_dur >= 20 and cur_ends_sentence:
            # Good natural break at sentence boundary — flush and start new
            cur["end"] = seg["end"]
            cur["text"] += " " + text
            cur["segments"].append(seg)
            flush(cur)
            cur = None
        else:
            # Keep accumulating
            cur["end"] = seg["end"]
            cur["text"] += " " + text
            cur["segments"].append(seg)
            # If ends a sentence and we have enough content, consider flushing
            if ends_sentence and would_be_dur >= 15:
                # Only flush if the next segment would push us past a threshold
                # We'll handle this lazily — just keep going until natural break
                pass

    if cur is not None:
        flush(cur)

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
    face_crop_x: float = 0
    face_crop_y: float = 0
    face_crop_w: float = 500
    face_crop_h: float = 500
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
    # Override clip timing (skip clips[] lookup)
    clip_start: Optional[float] = None
    clip_end: Optional[float] = None


def render_clip(video_path: str, start: float, duration: float,
                config: RenderConfig, output_path: Path) -> bool:
    """Render using scale+pad approach — no color=black canvas generator (too slow on CPU)."""
    vp = Path(video_path)
    logo_path = str(LOGO_PATH) if LOGO_PATH.exists() else None

    W, H = 720, 1280

    filters = []
    inputs = ["ffmpeg", "-y", "-ss", str(start), "-t", str(duration), "-i", str(vp)]
    logo_input_idx = None

    if logo_path and config.logo_visible:
        inputs += ["-i", logo_path]
        logo_input_idx = 1

    # ── Build base stream ──
    # Strategy: the face layer (or diagram if no face) becomes the base via scale+pad.
    # Additional layers are overlaid on top.
    # This avoids the slow `color=black` canvas source.

    base_built = False
    current = None

    # ── Face layer → base ──
    if config.face_visible:
        fx, fy = int(config.face_crop_x), int(config.face_crop_y)
        fw, fh = int(config.face_crop_w), int(config.face_crop_h)
        dx = int(config.face_dst_x * W)
        dy = int(config.face_dst_y * H)
        dw = int(config.face_dst_w * W)
        dh = int(config.face_dst_h * H)
        # Ensure even dimensions
        dw = dw + (dw % 2)
        dh = dh + (dh % 2)

        if dx == 0 and dy == 0 and dw == W and dh == H:
            # Fills the whole canvas — just crop+scale+pad directly
            filters.append(
                f"[0:v]crop={fw}:{fh}:{fx}:{fy},"
                f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black[base]"
            )
        else:
            # Partial placement: crop+scale to dest size, then pad to full canvas with black
            filters.append(
                f"[0:v]crop={fw}:{fh}:{fx}:{fy},"
                f"scale={dw}:{dh}:force_original_aspect_ratio=decrease,"
                f"pad={dw}:{dh}:(ow-iw)/2:(oh-ih)/2:black,"
                f"pad={W}:{H}:{dx}:{dy}:black[base]"
            )
        current = "base"
        base_built = True

    # ── Diagram layer ──
    if config.diagram_visible and config.diagram_crop_w:
        dx2 = int(config.diagram_dst_x * W)
        dy2 = int(config.diagram_dst_y * H)
        dw2 = int(config.diagram_dst_w * W)
        dh2 = int(config.diagram_dst_h * H)
        dw2 = dw2 + (dw2 % 2)
        dh2 = dh2 + (dh2 % 2)

        filters.append(
            f"[0:v]crop={config.diagram_crop_w}:{config.diagram_crop_h}:{config.diagram_crop_x}:{config.diagram_crop_y},"
            f"scale={dw2}:{dh2}:force_original_aspect_ratio=decrease,"
            f"pad={dw2}:{dh2}:(ow-iw)/2:(oh-ih)/2:black[diag_l]"
        )

        if not base_built:
            # Diagram is the base — pad it to full canvas
            filters.append(
                f"[diag_l]pad={W}:{H}:{dx2}:{dy2}:black[base]"
            )
            current = "base"
            base_built = True
        else:
            filters.append(f"[{current}][diag_l]overlay={dx2}:{dy2}[after_diag]")
            current = "after_diag"

    # ── If nothing visible, just scale the raw video to canvas ──
    if not base_built:
        filters.append(
            f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black[base]"
        )
        current = "base"

    # ── Logo layer ──
    if logo_path and config.logo_visible and logo_input_idx is not None:
        lx = int(config.logo_dst_x * W)
        ly = int(config.logo_dst_y * H)
        lw = int(config.logo_dst_w * W)
        lw = lw + (lw % 2)
        filters.append(
            f"[{logo_input_idx}:v]scale={lw}:-2,"
            f"format=rgba,colorchannelmixer=aa={config.logo_opacity}[logo_l]"
        )
        filters.append(f"[{current}][logo_l]overlay={lx}:{ly}[after_logo]")
        current = "after_logo"

    filter_complex = ";".join(filters)

    cmd = inputs + [
        "-filter_complex", filter_complex,
        "-map", f"[{current}]", "-map", "0:a",
        "-c:v", "libx264", "-crf", "26", "-preset", "ultrafast",
        "-tune", "fastdecode",
        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
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
        # video_path passed directly at upload time — should exist locally
        # If it doesn't (e.g. after a restart), try R2
        if not video_path.exists():
            job = load_job(job_id)
            video_path = ensure_video_local(job_id, job)
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
        err = str(e)
        # Mensaje legible para el usuario
        if "Precondition check failed" in err or "HTTP Error 400" in err:
            friendly = "YouTube bloqueó la descarga desde el servidor. Prueba con un video diferente o sube el archivo directamente."
        elif "Private video" in err or "This video is private" in err:
            friendly = "El video es privado y no se puede descargar."
        elif "age" in err.lower() and "restrict" in err.lower():
            friendly = "El video tiene restricción de edad."
        elif "not available" in err.lower():
            friendly = "El video no está disponible o fue eliminado."
        else:
            friendly = err
        update_job(job_id, status="error", error=friendly, step=f"Error: {friendly}")
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

    # Upload to R2 for persistence
    r2_key = f"uploads/{job_id}.mp4"
    if R2_ENABLED:
        try:
            r2_upload(video_path, r2_key)
        except Exception as e:
            print(f"[R2] upload error (non-fatal): {e}")

    save_job(job_id, {
        "id": job_id,
        "filename": file.filename,
        "size_mb": round(size_mb, 1),
        "status": "uploaded",
        "progress": 0,
        "step": "Video subido. Iniciando análisis...",
        "clips": [],
        "video_path": str(video_path),
        "r2_key": r2_key,
    })

    background_tasks.add_task(process_video_job, job_id, video_path)
    return {"job_id": job_id}


@app.get("/api/job/{job_id}")
async def get_job(job_id: str):
    return load_job(job_id)


class UrlRequest(BaseModel):
    url: str

@app.post("/api/upload-url")
async def upload_from_url(req: UrlRequest, background_tasks: BackgroundTasks):
    url = req.url.strip()
    if not url:
        raise HTTPException(400, "URL vacía")

    job_id = str(uuid.uuid4())[:8]
    video_path = UPLOADS_DIR / f"{job_id}.mp4"

    save_job(job_id, {
        "id": job_id,
        "filename": url,
        "size_mb": 0,
        "status": "downloading",
        "progress": 0,
        "step": "Descargando video de YouTube...",
        "clips": [],
        "video_path": str(video_path),
        "r2_key": f"uploads/{job_id}.mp4",
        "source_url": url,
    })

    background_tasks.add_task(download_and_process, job_id, url, video_path)
    return {"job_id": job_id}


async def download_and_process(job_id: str, url: str, video_path: Path):
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _yt_download, job_id, url, video_path)
        # Upload to R2
        r2_key = f"uploads/{job_id}.mp4"
        if R2_ENABLED:
            try:
                r2_upload(video_path, r2_key)
            except Exception as e:
                print(f"[R2] upload error (non-fatal): {e}")
        size_mb = round(video_path.stat().st_size / (1024 * 1024), 1)
        update_job(job_id, size_mb=size_mb, status="uploaded", step="Video descargado. Iniciando análisis...")
        await process_video_job(job_id, video_path)
    except Exception as e:
        err = str(e)
        # Mensaje legible para el usuario
        if "Precondition check failed" in err or "HTTP Error 400" in err:
            friendly = "YouTube bloqueó la descarga desde el servidor. Prueba con un video diferente o sube el archivo directamente."
        elif "Private video" in err or "This video is private" in err:
            friendly = "El video es privado y no se puede descargar."
        elif "age" in err.lower() and "restrict" in err.lower():
            friendly = "El video tiene restricción de edad."
        elif "not available" in err.lower():
            friendly = "El video no está disponible o fue eliminado."
        else:
            friendly = err
        update_job(job_id, status="error", error=friendly, step=f"Error: {friendly}")


def _yt_download(job_id: str, url: str, video_path: Path):
    import subprocess as sp

    cookies_file = os.environ.get("YT_COOKIES_FILE", "")
    cookies_extra = ["--cookies", cookies_file] if cookies_file and Path(cookies_file).exists() else []

    def run_attempt(extra_args: list, label: str):
        cmd = [
            "yt-dlp",
            "--no-playlist",
            "--merge-output-format", "mp4",
            "-o", str(video_path),
        ] + extra_args + cookies_extra + [url]
        print(f"[YT-DLP] intento {label}: {' '.join(cmd)}")
        r = sp.run(cmd, capture_output=True, text=True)
        print(f"[YT-DLP] {label} rc={r.returncode} stderr={r.stderr[-300:]}")
        return r

    # Intento 1: android_vr — no requiere PO token ni JS runtime
    r = run_attempt([
        "-f", "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--extractor-args", "youtube:player_client=android_vr",
    ], "android_vr")

    # Intento 2: android genérico
    if r.returncode != 0 or not video_path.exists():
        r = run_attempt([
            "-f", "best[ext=mp4]/best",
            "--extractor-args", "youtube:player_client=android",
        ], "android")

    # Intento 3: web con user-agent real
    if r.returncode != 0 or not video_path.exists():
        r = run_attempt([
            "-f", "best[ext=mp4]/best",
            "--extractor-args", "youtube:player_client=web",
            "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "--sleep-interval", "3",
        ], "web")

    if not video_path.exists():
        raise RuntimeError(f"yt-dlp no pudo descargar el video. Último error: {r.stderr[-600:]}")


render_jobs: dict = {}  # render_id -> {status, url, error}  (in-memory cache)

def save_render_job(render_id: str, data: dict):
    if _DATABASE_URL:
        try:
            conn = _get_pg()
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO render_jobs (id, data, updated_at)
                       VALUES (%s, %s::jsonb, %s)
                       ON CONFLICT (id) DO UPDATE
                       SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at""",
                    (render_id, json.dumps(data, ensure_ascii=False), int(time.time()))
                )
            return
        except Exception as e:
            print(f"[DB] save_render_job pg error: {e} — falling back to disk")
    # disk fallback
    with open(JOBS_DIR / f"render_{render_id}.json", "w") as f:
        json.dump(data, f)

def load_render_job(render_id: str) -> dict | None:
    if _DATABASE_URL:
        try:
            conn = _get_pg()
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM render_jobs WHERE id = %s", (render_id,))
                row = cur.fetchone()
            if row:
                return row[0] if isinstance(row[0], dict) else json.loads(row[0])
            return render_jobs.get(render_id)
        except Exception as e:
            print(f"[DB] load_render_job pg error: {e} — falling back to disk")
    # disk fallback
    p = JOBS_DIR / f"render_{render_id}.json"
    if not p.exists():
        return render_jobs.get(render_id)
    with open(p) as f:
        return json.load(f)

def set_render_state(render_id: str, data: dict):
    render_jobs[render_id] = data  # keep in-memory cache too
    save_render_job(render_id, data)

async def do_render_background(render_id: str, config: RenderConfig, job: dict):
    try:
        set_render_state(render_id, {"status": "rendering"})
        print(f"[RENDER] {render_id} starting...")

        video_path = ensure_video_local(config.job_id, job)
        print(f"[RENDER] video_path={video_path} exists={Path(video_path).exists()}")

        # Timing: use explicit override or fall back to clips[]
        if config.clip_start is not None and config.clip_end is not None:
            start = config.clip_start
            duration = config.clip_end - config.clip_start
        else:
            clips = job.get("clips", [])
            clip = clips[config.clip_index]
            start = clip["start"]
            duration = clip["end"] - clip["start"]

        print(f"[RENDER] start={start} duration={duration}")
        out_name = f"{config.job_id}_clip{config.clip_index}.mp4"
        output_path = OUTPUTS_DIR / out_name

        import time as _time
        t0 = _time.time()
        loop = asyncio.get_event_loop()
        success = await loop.run_in_executor(
            None, render_clip, str(video_path), start, duration, config, output_path
        )
        elapsed = _time.time() - t0
        print(f"[RENDER] ffmpeg done in {elapsed:.1f}s success={success}")

        if not success:
            set_render_state(render_id, {"status": "error", "error": "ffmpeg falló"})
            return

        if R2_ENABLED:
            try:
                await loop.run_in_executor(None, r2_upload, output_path, f"outputs/{out_name}")
                print(f"[RENDER] uploaded to R2: outputs/{out_name}")
            except Exception as e:
                print(f"[R2] output upload error (non-fatal): {e}")

        set_render_state(render_id, {"status": "done", "url": f"/api/download/{out_name}", "filename": out_name})
        print(f"[RENDER] {render_id} DONE")
    except Exception as e:
        import traceback
        print(f"[RENDER] ERROR: {e}\n{traceback.format_exc()}")
        set_render_state(render_id, {"status": "error", "error": str(e)})


@app.post("/api/render")
async def render_clip_endpoint(config: RenderConfig, background_tasks: BackgroundTasks):
    job = load_job(config.job_id)
    # Allow clip_start/clip_end override without needing clips[] entry
    if config.clip_start is None or config.clip_end is None:
        clips = job.get("clips", [])
        if config.clip_index >= len(clips):
            raise HTTPException(400, "Clip index out of range")

    render_id = f"{config.job_id}_clip{config.clip_index}"
    set_render_state(render_id, {"status": "rendering"})  # persist immediately
    background_tasks.add_task(do_render_background, render_id, config, job)
    print(f"[RENDER] queued {render_id}")
    return {"render_id": render_id, "status": "rendering"}


@app.get("/api/render_status/{render_id}")
async def render_status(render_id: str):
    state = load_render_job(render_id)
    print(f"[STATUS] {render_id} → {state}")
    if state is None:
        raise HTTPException(404, "Render not found")
    return state


@app.get("/api/download/{filename}")
async def download_file(filename: str):
    p = OUTPUTS_DIR / filename
    if not p.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(str(p), media_type="video/mp4", filename=filename)


@app.get("/api/frame/{job_id}")
async def get_frame(job_id: str, t: float = 0):
    job = load_job(job_id)
    frame_path = OUTPUTS_DIR / f"{job_id}_frame.jpg"
    if not frame_path.exists():
        # Ensure video is local (download from R2 if needed)
        try:
            video_path = ensure_video_local(job_id, job)
        except Exception as e:
            raise HTTPException(404, f"Video no disponible para extraer frame: {e}")
        subprocess.run([
            "ffmpeg", "-y", "-ss", str(t), "-i", str(video_path),
            "-vframes", "1", "-q:v", "3", "-vf", "scale=1280:-1",
            str(frame_path)
        ], capture_output=True)
    if not frame_path.exists():
        raise HTTPException(404, "Frame not found")
    return FileResponse(str(frame_path), media_type="image/jpeg")


@app.get("/api/logo")
async def get_logo():
    if not LOGO_PATH.exists():
        raise HTTPException(404, "Logo not found")
    return FileResponse(str(LOGO_PATH), media_type="image/jpeg")


@app.get("/api/health")
async def health():
    return {"status": "ok", "groq": bool(GROQ_API_KEY), "r2": R2_ENABLED}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)

# AstroClips

App para generar clips virales de TikTok desde clases de astrología grabadas.

## Qué hace

1. **Sube** un video largo (hasta 120 min)
2. **Transcribe** con Whisper (local, gratis, español)
3. **Detecta clips virales** con Groq Llama 3.1 70B (gratis)
4. **Detecta cara** de Antonio y diagramas astrológicos automáticamente
5. **Editor** de recorte: ajusta cara, presentación, logo
6. **Exporta** clip en 9:16 listo para TikTok + descripción sugerida

## Stack

- **Frontend**: React + Vite + Tailwind CSS v4 + Hono (Cloudflare Workers)
- **Procesador**: Python + FastAPI + faster-whisper + OpenCV + ffmpeg
- **IA**: Groq API (Llama 3.1 70B) — gratis

## Setup

### 1. Variables de entorno

Crea un archivo `.env` en la raíz:

```env
GROQ_API_KEY=tu_key_aqui
LOGO_PATH=/ruta/al/logo.jpg
```

Consigue tu API key gratis en: https://console.groq.com/keys

### 2. Instalar dependencias Python

```bash
pip install fastapi uvicorn python-multipart groq faster-whisper opencv-python-headless numpy
```

También necesitas `ffmpeg` instalado en el sistema:
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# Mac
brew install ffmpeg
```

### 3. Instalar dependencias frontend

```bash
bun install
```

### 4. Arrancar

**Terminal 1 — Procesador Python:**
```bash
cd processor
GROQ_API_KEY=tu_key python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — Frontend:**
```bash
bun dev --port 8080
```

Abre http://localhost:8080

## Uso

1. Arrastra o selecciona un video de clase
2. Espera el análisis (transcripción + IA + detección visual)
3. Ve los clips sugeridos ordenados por score viral
4. Haz clic en "Editar" en cualquier clip
5. Ajusta recorte de cara / diagrama / logo con los sliders
6. Pulsa "Generar clip" → descarga el MP4 en 9:16
7. Copia la descripción sugerida para TikTok

## Layout de clips

- **Solo cara**: la cara de Antonio ocupa toda la pantalla 9:16
- **Dividido**: cara arriba (50%) + diagrama astrológico abajo (50%)

En ambos casos el logo aparece como marca de agua configurable.

## Despliegue

El frontend se despliega en Cloudflare Workers via `wrangler`.
El procesador Python necesita un servidor con Python 3.10+ y ffmpeg (ej: Railway, Render, VPS).

```bash
# Frontend
bun run deploy

# Procesador (con Railway/Render — ver su documentación)
# O en VPS:
gunicorn -w 2 -k uvicorn.workers.UvicornWorker processor.main:app
```

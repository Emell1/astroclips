FROM jrottenberg/ffmpeg:4.4-ubuntu2004 AS ffmpeg
FROM python:3.11-slim

# Copy ffmpeg from dedicated image
COPY --from=ffmpeg /usr/local /usr/local

# Minimal system deps
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads outputs jobs

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}

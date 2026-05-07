# Stage 1: Build React frontend (sin plugin de Cloudflare)
FROM node:20-slim AS react-builder
WORKDIR /app

COPY package.json bun.lock* ./
RUN npm install --legacy-peer-deps

COPY index.html tsconfig.app.json tsconfig.json components.json ./
COPY public ./public
COPY src/web ./src/web
COPY vite ./vite
COPY frontend/vite.railway.config.ts ./vite.railway.config.ts

RUN npx vite build --config vite.railway.config.ts

# Stage 2: Build Node/Hono server
FROM node:20-slim AS server-builder
WORKDIR /server

COPY frontend/package.json ./
RUN npm install

COPY frontend/tsconfig.json ./
COPY frontend/src ./src
RUN npx tsc

# Stage 3: Imagen final
FROM node:20-slim
WORKDIR /app

COPY --from=server-builder /server/node_modules ./node_modules
COPY --from=server-builder /server/dist ./dist
COPY --from=react-builder /app/dist/client ./public

EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM node:20-slim
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --omit=dev

COPY frontend/dist ./dist
COPY frontend/public ./public

EXPOSE 3000
CMD ["node", "dist/server.js"]

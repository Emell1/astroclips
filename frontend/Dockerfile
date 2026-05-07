FROM node:20-slim
WORKDIR /app

COPY frontend/package.json ./
RUN npm install --omit=dev

COPY frontend/dist ./dist
COPY dist/client ./public

EXPOSE 3000
CMD ["node", "dist/server.js"]

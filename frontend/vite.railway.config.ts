import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";

// Este config se ejecuta desde el repo root (/app en Docker)
// El Dockerfile copia el repo entero a /app y luego:
//   npx vite build --config frontend/vite.railway.config.ts
// process.cwd() = /app (repo root)

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "src/web"),
    },
  },
  root: process.cwd(),
  build: {
    outDir: path.resolve(process.cwd(), "dist/client"),
    emptyOutDir: true,
  },
});

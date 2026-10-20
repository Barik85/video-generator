import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API = process.env.API_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": { target: API, changeOrigin: true } },
  },
  preview: {
    proxy: { "/api": { target: API, changeOrigin: true } },
  },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "static" },
  server: { port: 5480, proxy: { "/api": { target: "http://localhost:3800", changeOrigin: true } } },
});

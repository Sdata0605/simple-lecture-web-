import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // The development server is also used by the current hosted environment.
    // Keep requests outside this application from reaching Vite's transformer
    // (for example, probes for /home/<user>/.bash_history).
    fs: {
      strict: true,
      allow: [path.resolve(__dirname)],
    },
    // A failed request must not broadcast a full-screen error over an active
    // lecture. Build errors remain visible in the server logs and console.
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));

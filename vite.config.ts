import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["pptxgenjs"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

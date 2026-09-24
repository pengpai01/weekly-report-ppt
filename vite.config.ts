import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { listenPort } from "./server/config.js";
import { createConnectApi } from "./server/http.js";
import { createReportStore } from "./server/store.js";

function reportsApiPlugin(): Plugin {
  const store = { current: null as ReturnType<typeof createReportStore> | null };
  const middleware = () => {
    store.current ??= createReportStore();
    return createConnectApi(store.current);
  };
  return {
    name: "weekly-report-ppt-api",
    configureServer(server) {
      return () => {
        server.middlewares.use(middleware());
      };
    },
    configurePreviewServer(server) {
      return () => {
        server.middlewares.use(middleware());
      };
    },
  };
}

const port = listenPort();
const isVitest = Boolean(process.env.VITEST);

export default defineConfig({
  plugins: [react(), ...(isVitest ? [] : [reportsApiPlugin()])],
  server: {
    host: true,
    port,
    strictPort: false,
  },
  preview: {
    host: true,
    port,
    strictPort: false,
  },
  define: {
    global: "globalThis",
  },
  assetsInclude: ["**/*.pptx"],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "server/**/*.test.ts"],
  },
});

import { defineConfig } from "vite";

const pumpApiProxy = {
  "/pump-api": {
    target: "https://frontend-api-v3.pump.fun",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/pump-api/, "") || "/",
    configure(proxy) {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("Origin", "https://pump.fun");
        proxyReq.setHeader("Referer", "https://pump.fun/");
        proxyReq.setHeader("Accept", "application/json");
        proxyReq.setHeader(
          "User-Agent",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        );
      });
    },
  },
} as const;

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    proxy: pumpApiProxy,
  },
  preview: {
    proxy: pumpApiProxy,
  },
});

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full origin (no trailing slash) of a reverse-proxy that mirrors Pump.fun, e.g. https://pump-proxy.yourdomain.workers.dev */
  readonly VITE_PUMP_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

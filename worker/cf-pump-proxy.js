/**
 * Cloudflare Worker — deploy and point VITE_PUMP_API_BASE at your worker origin (no path).
 * Example: VITE_PUMP_API_BASE=https://pump-proxy.your-account.workers.dev
 * Client will GET {VITE_PUMP_API_BASE}/coins?limit=56&offset=0&sort=trending
 */
export default {
  /**
   * @param {Request} request
   */
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(
      `${incoming.pathname}${incoming.search}`,
      "https://frontend-api-v3.pump.fun",
    );

    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers: {
        origin: "https://pump.fun",
        referer: "https://pump.fun/",
        accept: request.headers.get("accept") || "application/json",
        "user-agent":
          request.headers.get("user-agent") ||
          "Mozilla/5.0 (compatible; OuroborosPumpProxy/1.0)",
      },
    });

    const body = await upstream.arrayBuffer();
    const ct = upstream.headers.get("content-type") || "application/json; charset=utf-8";

    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": ct,
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  },
};

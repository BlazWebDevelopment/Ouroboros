type PumpCoin = {
  mint: string;
  name: string;
  symbol: string;
  image_uri?: string;
  usd_market_cap?: number;
  market_cap?: number;
  ath_market_cap?: number;
  complete?: boolean;
  last_trade_timestamp?: number;
};

type BoostToken = {
  chainId: string;
  tokenAddress: string;
  url?: string;
};

type BoostResponse = {
  value?: BoostToken[];
};

type DexPair = {
  chainId: string;
  dexId: string;
  url: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  volume?: { h24?: number };
  liquidity?: { usd?: number };
};

type DexTokensResponse = {
  pairs?: DexPair[] | null;
};

type TableRow = {
  image: string | null;
  name: string;
  symbol: string;
  mint: string;
  usdMc: number | null;
  solMc: number | null;
  athUsd: number | null;
  status: string;
  lastTrade: string;
  pumpUrl: string;
};

type FeedCoin = { symbol: string; mint: string; name: string };

const PUMP_PROXY = "/pump-api";
const BOOST_LATEST = "https://api.dexscreener.com/token-boosts/latest/v1";
const BOOST_TOP = "https://api.dexscreener.com/token-boosts/top/v1";
const DEX_TOKENS = "https://api.dexscreener.com/latest/dex/tokens";
/** How often the trending table re-fetches (ms). */
const TRENDING_POLL_MS = 1000;
/** Wall-clock period (ms): all visitors share the same serpent line on the same beat. */
const FEED_LINE_PERIOD_MS = 2000;
/** How often we check for the next feed line (ms). */
const FEED_ALIGN_POLL_MS = 250;
const FEED_MAX_LINES = 18;

const feedCoinsRef: { coins: FeedCoin[] } = { coins: [] };
let feedStarted = false;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function mapPumpCoins(coins: PumpCoin[]): TableRow[] {
  return coins.map((c) => ({
    image: safeImageUrl(c.image_uri),
    name: c.name ?? "—",
    symbol: (c.symbol ?? "").trim() || "—",
    mint: c.mint,
    usdMc: typeof c.usd_market_cap === "number" ? c.usd_market_cap : null,
    solMc: typeof c.market_cap === "number" ? c.market_cap : null,
    athUsd: typeof c.ath_market_cap === "number" ? c.ath_market_cap : null,
    status: c.complete ? "Graduated" : "Bonding",
    lastTrade: formatAgo(c.last_trade_timestamp),
    pumpUrl: `https://pump.fun/coin/${encodeURIComponent(c.mint)}`,
  }));
}

function safeImageUrl(uri?: string): string | null {
  if (!uri) return null;
  const t = uri.trim();
  if (t.startsWith("https://") || t.startsWith("http://")) return t;
  return null;
}

function formatAgo(ts?: number): string {
  if (!ts || typeof ts !== "number") return "—";
  const tsSec = ts > 10_000_000_000 ? Math.floor(ts / 1000) : ts;
  const sec = Math.max(0, Math.round(Date.now() / 1000 - tsSec));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

async function loadPumpTrending(limit = 56): Promise<PumpCoin[]> {
  const url = `${PUMP_PROXY}/coins?limit=${limit}&offset=0&sort=trending`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Pump.fun ${res.status}`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Pump.fun returned unexpected JSON");
  }
  return data as PumpCoin[];
}

function mergeBoosts(latest: BoostResponse, top: BoostResponse): string[] {
  const merged: string[] = [];
  const push = (entry?: BoostToken) => {
    if (!entry) return;
    if (entry.chainId?.toLowerCase() !== "solana") return;
    const addr = entry.tokenAddress?.trim();
    if (!addr) return;
    merged.push(addr);
  };
  for (const item of latest.value ?? []) push(item);
  for (const item of top.value ?? []) push(item);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const addr of merged) {
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(addr);
  }
  return deduped;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function parseNumber(value?: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function bestPairForMint(pairs: DexPair[], mint: string): DexPair | null {
  const mintLower = mint.toLowerCase();
  const matches = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === mintLower);
  if (!matches.length) return null;
  return [...matches].sort((a, b) => {
    const la = a.liquidity?.usd ?? 0;
    const lb = b.liquidity?.usd ?? 0;
    return lb - la;
  })[0];
}

async function loadDexFallbackRows(): Promise<TableRow[]> {
  const [latest, top] = await Promise.all([
    fetchJson<BoostResponse>(BOOST_LATEST),
    fetchJson<BoostResponse>(BOOST_TOP),
  ]);
  const mints = mergeBoosts(latest, top).slice(0, 48);
  const rows: TableRow[] = [];
  for (const group of chunk(mints, 24)) {
    const path = `${DEX_TOKENS}/${group.map(encodeURIComponent).join(",")}`;
    const data = await fetchJson<DexTokensResponse>(path);
    const pairs = data.pairs ?? [];
    for (const mint of group) {
      const pair = bestPairForMint(pairs, mint);
      if (!pair) continue;
      const price = parseNumber(pair.priceUsd);
      rows.push({
        image: null,
        name: pair.baseToken.name,
        symbol: pair.baseToken.symbol,
        mint: pair.baseToken.address,
        usdMc: null,
        solMc: null,
        athUsd: null,
        status: price !== null ? `${pair.dexId} · spot ${formatUsd(price)}` : pair.dexId,
        lastTrade: "—",
        pumpUrl: `https://pump.fun/coin/${encodeURIComponent(pair.baseToken.address)}`,
      });
    }
  }
  return rows;
}

function formatUsd(value: number | null, digits = 2): string {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value < 1) return `$${value.toFixed(digits)}`;
  if (value < 1000) return `$${value.toFixed(0)}`;
  if (value < 1_000_000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${(value / 1_000_000).toFixed(2)}M`;
}

function formatSol(value: number | null): string {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "—";
  if (value >= 1000) return `${value.toFixed(0)}`;
  if (value >= 100) return `${value.toFixed(1)}`;
  return `${value.toFixed(2)}`;
}

function shortMint(mint: string): string {
  if (mint.length <= 10) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function renderRows(target: HTMLElement, rows: TableRow[]) {
  if (!rows.length) {
    target.innerHTML =
      '<tr><td colspan="10" class="error">No rows returned. Try again in a moment.</td></tr>';
    return;
  }
  target.innerHTML = rows
    .map((row) => {
      const img = row.image
        ? `<img class="coin-thumb" src="${escapeAttr(row.image)}" width="40" height="40" alt="" loading="lazy" referrerpolicy="no-referrer" />`
        : `<div class="coin-thumb coin-thumb--ph" aria-hidden="true"></div>`;
      return `
      <tr>
        <td class="thumb-cell">${img}</td>
        <td class="token-cell">${escapeHtml(row.name)}</td>
        <td><span class="pill">${escapeHtml(row.symbol)}</span></td>
        <td class="mono">${escapeHtml(shortMint(row.mint))}</td>
        <td class="num">${formatUsd(row.usdMc)}</td>
        <td class="num">${formatSol(row.solMc)}</td>
        <td class="num">${formatUsd(row.athUsd)}</td>
        <td><span class="status">${escapeHtml(row.status)}</span></td>
        <td class="mono tight">${escapeHtml(row.lastTrade)}</td>
        <td><a class="table-link" href="${escapeAttr(row.pumpUrl)}" target="_blank" rel="noreferrer">Pump.fun</a></td>
      </tr>`;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function mix32(n: number): number {
  return Math.imul(n | 0, 0x9e3779b1) >>> 0;
}

const SERPENT_IDLE_LINES = [
  "Protocol hum: the serpent scouts the bonding cliffs…",
  "Coils idle—mesh warming while the board syncs…",
  "Ouroboros listens: the next tax slice is already queuing…",
  "Serpent spine online—awaiting mints from the live wire…",
];

function pickPairIndices(bucket: number, n: number): [number, number] {
  if (n < 2) return [0, 0];
  const i = mix32(bucket + 1) % n;
  let j = mix32(bucket + 2) % n;
  if (j === i) j = (j + 1) % n;
  return [i, j];
}

function buildSerpentLine(bucket: number, coins: FeedCoin[]): string {
  const n = coins.length;
  if (n < 2) {
    return SERPENT_IDLE_LINES[mix32(bucket) % SERPENT_IDLE_LINES.length]!;
  }
  const [i, j] = pickPairIndices(bucket, n);
  const ordered = [...coins].sort((a, b) => a.mint.localeCompare(b.mint));
  const primary = ordered[i]!;
  const secondary = ordered[j]!;
  const a = primary.symbol;
  const b = secondary.symbol;
  const bite = (mix32(bucket + 9) % 9999) + 1;
  const variant = mix32(bucket + 3) % 6;
  switch (variant) {
    case 0:
      return `Tax slice routed — circling ${a} and ${b}`;
    case 1:
      return `Serpent jaws flex — prioritizing ${a} over ${b} volatility`;
    case 2:
      return `Burn queue warmed — ${a} marked, ${b} collateralized`;
    case 3:
      return `Routing appetite: skim ${a}, echo ${b}`;
    case 4:
      return `Ouroboros bite #${bite} — tasting ${a}, nudging ${b}`;
    default:
      return `Liquidity fangs — ${a} swallowed into digestor; ${b} on deck`;
  }
}

function startGlobalSerpentFeed(list: HTMLElement, getCoins: () => FeedCoin[]) {
  if (feedStarted) return;
  feedStarted = true;

  let lastEmittedBucket = -1;

  const appendLine = (message: string) => {
    const li = document.createElement("li");
    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = `${new Date().toLocaleTimeString("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })} UTC`;
    const msg = document.createElement("span");
    msg.className = "msg";
    msg.textContent = message;
    li.append(ts, msg);
    list.prepend(li);
    while (list.children.length > FEED_MAX_LINES) {
      list.removeChild(list.lastChild!);
    }
  };

  const tick = () => {
    const bucket = Math.floor(Date.now() / FEED_LINE_PERIOD_MS);
    if (bucket <= lastEmittedBucket) return;
    lastEmittedBucket = bucket;
    appendLine(buildSerpentLine(bucket, getCoins()));
  };

  lastEmittedBucket = Math.floor(Date.now() / FEED_LINE_PERIOD_MS) - 1;
  tick();
  window.setInterval(tick, FEED_ALIGN_POLL_MS);
}

function setBoardSubtitle(el: HTMLElement | null, text: string) {
  if (el) el.textContent = text;
}

function setSyncLabel(sync: HTMLElement | null, text: string) {
  if (sync) sync.textContent = text;
}

function applyRows(tbody: HTMLElement, rows: TableRow[]) {
  renderRows(tbody, rows);
  feedCoinsRef.coins = rows.map((r) => ({ symbol: r.symbol, mint: r.mint, name: r.name }));
}

async function tickPumpBoard(tbody: HTMLElement): Promise<boolean> {
  try {
    const pumpCoins = await loadPumpTrending(56);
    const rows = mapPumpCoins(pumpCoins);
    if (!rows.length) return false;
    applyRows(tbody, rows);
    return true;
  } catch {
    return false;
  }
}

async function tickDexBoard(tbody: HTMLElement): Promise<boolean> {
  try {
    const rows = await loadDexFallbackRows();
    if (!rows.length) return false;
    applyRows(tbody, rows);
    return true;
  } catch {
    return false;
  }
}

function startTrendingData(
  tbody: HTMLElement,
  sub: HTMLElement | null,
  sync: HTMLElement | null,
) {
  let busy = false;
  let announced = false;
  let failStreak = 0;

  const stamp = () => {
    const t = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setSyncLabel(sync, `· Auto-refresh (${TRENDING_POLL_MS / 1000}s) · ${t}`);
  };

  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      if (await tickPumpBoard(tbody)) {
        if (!announced) {
          announced = true;
          setBoardSubtitle(
            sub,
            "Pump.fun trending (sort=trending). Updates about every second. On your own domain: run npm run build then npm start (serves dist/ and proxies /pump-api), or configure nginx to forward /pump-api to frontend-api-v3.pump.fun with Origin https://pump.fun.",
          );
        }
        stamp();
        failStreak = 0;
        return;
      }
      if (await tickDexBoard(tbody)) {
        if (!announced) {
          announced = true;
          setBoardSubtitle(
            sub,
            "Pump.fun was not reachable from the browser (CORS or missing /pump-api). Showing DexScreener boosts instead. For Pump data on your domain use npm start after build, or add a reverse proxy for /pump-api.",
          );
        }
        stamp();
        failStreak = 0;
        return;
      }
      failStreak += 1;
      if (!announced && failStreak >= 4) {
        tbody.innerHTML = `<tr><td colspan="10" class="error">Could not load Pump.fun or DexScreener after several tries. On your domain run <strong>npm run build</strong> then <strong>npm start</strong> so <code>/pump-api</code> is proxied to Pump.fun.</td></tr>`;
        setSyncLabel(sync, "");
      }
    } finally {
      busy = false;
    }
  };

  void run();
  window.setInterval(run, TRENDING_POLL_MS);
}

function boot() {
  const tbody = document.querySelector<HTMLTableSectionElement>("#coin-rows");
  const feed = document.querySelector<HTMLUListElement>("#feed-lines");
  const sub = document.querySelector<HTMLElement>("#board-sub");
  const sync = document.querySelector<HTMLElement>("#board-sync");
  if (!tbody || !feed) return;

  startGlobalSerpentFeed(feed, () => feedCoinsRef.coins);
  startTrendingData(tbody, sub, sync);
}

void boot();

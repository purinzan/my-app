// src/lib/jquants.ts
import { tursoClient } from "@/lib/db";

const BASE = "https://api.jquants.com/v1";

type Quote = {
  Date: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
};

type ListedInfo = {
  Code: string;
  CompanyName: string;
  CompanyNameEnglish?: string;
  MarketCode?: string;
  MarketCodeName?: string;
};

function isISODate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function log(rid: string | undefined, msg: string, obj?: any) {
  if (!rid) return;
  const t = new Date().toISOString();
  if (obj === undefined) console.log(`[jquants:${rid}] ${t} ${msg}`);
  else console.log(`[jquants:${rid}] ${t} ${msg}`, obj);
}

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return { ok: true as const, json: JSON.parse(text), text };
  } catch {
    return { ok: false as const, json: null, text };
  }
}

async function getIdTokenFromRefresh(refreshToken: string, rid?: string) {
  const url = new URL(`${BASE}/token/auth_refresh`);
  url.searchParams.set("refreshtoken", refreshToken);

  log(rid, "auth_refresh start", { refreshTokenLen: refreshToken.length });

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  const parsed = await safeJson(res);
  log(rid, "auth_refresh response", {
    status: res.status,
    ok: res.ok,
    bodyPreview: parsed.text.slice(0, 160),
  });

  if (!res.ok || !parsed.ok) throw new Error(`auth_refresh failed: ${res.status}`);
  const idToken = parsed.json?.idToken;
  if (!idToken) throw new Error("auth_refresh missing idToken");
  return String(idToken);
}

async function fetchListedInfoByCode(code: string, idToken: string, rid?: string) {
  const url = new URL(`${BASE}/listed/info`);
  url.searchParams.set("code", code);

  log(rid, "listed/info request", { url: url.toString() });

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });

  const parsed = await safeJson(res);
  log(rid, "listed/info response", {
    status: res.status,
    ok: res.ok,
    bodyPreview: parsed.text.slice(0, 200),
  });

  if (!res.ok || !parsed.ok) throw new Error(`listed/info failed: ${res.status}`);

  const info: ListedInfo[] = Array.isArray(parsed.json?.info) ? parsed.json.info : [];
  return info;
}

/**
 * daily_quotes 全ページ取得（pagination_key対応）
 * daily_quotes は pagination_key が返ることがあるので取りこぼし防止。:contentReference[oaicite:3]{index=3}
 */
async function fetchDailyQuotesAllPages(params: { code: string; from: string; to: string; idToken: string; rid?: string }) {
  const { code, from, to, idToken, rid } = params;

  const all: Quote[] = [];
  let paginationKey: string | null = null;
  let page = 0;

  while (true) {
    const url = new URL(`${BASE}/prices/daily_quotes`);
    url.searchParams.set("code", code);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    if (paginationKey) url.searchParams.set("pagination_key", paginationKey);

    log(rid, "daily_quotes request", { page, url: url.toString() });

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });

    const parsed = await safeJson(res);
    log(rid, "daily_quotes response", {
      page,
      status: res.status,
      ok: res.ok,
      bodyPreview: parsed.text.slice(0, 220),
    });

    if (!res.ok || !parsed.ok) throw new Error(`daily_quotes failed: ${res.status}`);

    const quotes: Quote[] = Array.isArray(parsed.json?.daily_quotes) ? parsed.json.daily_quotes : [];
    all.push(...quotes);

    paginationKey = parsed.json?.pagination_key ? String(parsed.json.pagination_key) : null;
    log(rid, "daily_quotes parsed", { page, got: quotes.length, total: all.length, paginationKey });

    if (!paginationKey) break;

    page += 1;
    if (page > 50) throw new Error("daily_quotes pagination too deep (safety break)");
  }

  return all;
}

/**
 * 指定範囲のJ-Quants日足をDBへUPSERT（存在すれば上書き、なければ追加）
 * 戻り値の upserted は「INSERT+UPDATE の合計 changes」
 */
export async function syncDailyQuotesToDB(input: { code: string; from: string; to: string; rid?: string }) {
  const { code, from, to, rid } = input;

  if (!code) throw new Error("missing code");
  if (!isISODate(from) || !isISODate(to)) throw new Error("from/to must be YYYY-MM-DD");
  if (from > to) throw new Error("from must be <= to");

  const refreshToken = process.env.JQUANTS_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("missing JQUANTS_REFRESH_TOKEN");

  const idToken = await getIdTokenFromRefresh(refreshToken, rid);

  // まず listed/info で「その銘柄が収録されてるか」チェック
  // （未収録なら daily_quotes は空配列になりやすいので原因を明確化）:contentReference[oaicite:4]{index=4}
  const info = await fetchListedInfoByCode(code, idToken, rid);
  if (info.length === 0) {
    log(rid, "code not found in listed/info -> stop");
    return {
      fetched: 0,
      upserted: 0,
      first: null,
      last: null,
      reason: "code-not-found-in-listed-info" as const,
      listedCount: 0,
    };
  }

  // daily_quotes（全ページ）
  const quotes = await fetchDailyQuotesAllPages({ code, from, to, idToken, rid });

  if (quotes.length === 0) {
    // listed にはあるが、この期間は0件（新規上場直後など）という状態を区別
    return {
      fetched: 0,
      upserted: 0,
      first: null,
      last: null,
      reason: "no-quotes-in-range" as const,
      listedCount: info.length,
    };
  }

  const rows = quotes.map((q) => ({
    code,
    date: q.Date,
    open: Number(q.Open),
    high: Number(q.High),
    low: Number(q.Low),
    close: Number(q.Close),
    volume: Number(q.Volume),
  }));

  let upserted = 0;

  const stmts = rows.map((r) => ({
    sql: `
      INSERT INTO prices_daily (code, date, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code, date) DO UPDATE SET
        open   = excluded.open,
        high   = excluded.high,
        low    = excluded.low,
        close  = excluded.close,
        volume = excluded.volume
    `,
    args: [r.code, r.date, r.open, r.high, r.low, r.close, r.volume],
  }));

  const results = await tursoClient.batch(stmts, "write");
  for (const rr of results as any[]) {
    upserted += Number(rr?.rowsAffected ?? 0);
  }

  return {
    fetched: quotes.length,
    upserted,
    first: quotes[0]?.Date ?? null,
    last: quotes.at(-1)?.Date ?? null,
    reason: "ok" as const,
    listedCount: info.length,
  };
}

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

function isISODate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return { ok: true as const, json: JSON.parse(text), text };
  } catch {
    return { ok: false as const, json: null, text };
  }
}

async function getIdTokenFromRefresh(refreshToken: string) {
  const url = new URL(`${BASE}/token/auth_refresh`);
  url.searchParams.set("refreshtoken", refreshToken);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  const parsed = await safeJson(res);
  if (!res.ok || !parsed.ok) throw new Error(`auth_refresh failed: ${res.status}`);
  const idToken = parsed.json?.idToken;
  if (!idToken) throw new Error("auth_refresh missing idToken");
  return String(idToken);
}

async function fetchDailyQuotes(params: { code: string; from: string; to: string }) {
  const refreshToken = process.env.JQUANTS_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("missing JQUANTS_REFRESH_TOKEN");

  const idToken = await getIdTokenFromRefresh(refreshToken);

  const url = new URL(`${BASE}/prices/daily_quotes`);
  url.searchParams.set("code", params.code);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });

  const parsed = await safeJson(res);
  if (!res.ok || !parsed.ok) throw new Error(`daily_quotes failed: ${res.status}`);

  const quotes: Quote[] = Array.isArray(parsed.json?.daily_quotes) ? parsed.json.daily_quotes : [];
  return quotes;
}

/**
 * 指定範囲のJ-Quants日足をDBへUPSERT（存在すれば上書き、なければ追加）
 * 戻り値の upserted は「INSERT+UPDATE の合計 changes」
 */
export async function syncDailyQuotesToDB(input: { code: string; from: string; to: string }) {
  const { code, from, to } = input;

  if (!code) throw new Error("missing code");
  if (!isISODate(from) || !isISODate(to)) throw new Error("from/to must be YYYY-MM-DD");
  if (from > to) throw new Error("from must be <= to");

  const quotes = await fetchDailyQuotes({ code, from, to });

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

  if (rows.length > 0) {
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
  }

  return {
    fetched: quotes.length,
    upserted, // ★ここが「DBが変わった」指標
    first: quotes[0]?.Date ?? null,
    last: quotes.at(-1)?.Date ?? null,
  };
}

import { NextResponse } from "next/server";
import { tursoClient } from "@/lib/db";
import path from "path";
import { readFile } from "fs/promises";
import dns from "dns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.jquants.com/v1";
dns.setDefaultResultOrder("ipv4first");
type MarketCapMode = "over" | "under";

type DailyQuote = {
  Date: string;
  Code: string;
  Open: number | null;
  High: number | null;
  Low: number | null;
  Close: number | null;
  Volume: number | null;
};

function normalizeCode(x: string) {
  // Pythonの normalize_code に寄せる（"6740.0" や "6740-T" を想定）
  const s = String(x ?? "").trim();
  const m = s.match(/(\d{4})/);
  return m ? m[1] : "";
}

function detectDelimiter(line: string) {
  const tab = (line.match(/	/g) ?? []).length;
  const comma = (line.match(/,/g) ?? []).length;
  return tab > comma ? "	" : ",";
}

function splitCsvLine(line: string, delim: string) {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === delim) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map((s) => s.trim());
}

let cachedMarketCapMap: Map<string, number> | null = null;

async function loadMarketCapMapFromPublicCsv() {
  if (cachedMarketCapMap) return cachedMarketCapMap;

  const csvPath = path.join(process.cwd(), "public", "listed_info.csv");
  let buf: Buffer;
  try {
    buf = await readFile(csvPath);
  } catch {
    cachedMarketCapMap = new Map();
    return cachedMarketCapMap;
  }

  let text = buf.toString("utf8").replace(/^﻿/, "");
  text = text.replace(/

/g, "
").replace(/
/g, "
").trim();
  const lines = text.split("
").filter(Boolean);
  if (lines.length < 2) {
    cachedMarketCapMap = new Map();
    return cachedMarketCapMap;
  }

  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.replace(/^"|"$/g, "").trim());
  const idxCode = headers.indexOf("Code");
  const idxCap = headers.indexOf("MarketCap");
  if (idxCode < 0 || idxCap < 0) {
    cachedMarketCapMap = new Map();
    return cachedMarketCapMap;
  }

  const map = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim).map((v) => v.replace(/^"|"$/g, "").trim());
    const code = normalizeCode(String(cols[idxCode] ?? ""));
    if (!code) continue;
    const capRaw = String(cols[idxCap] ?? "");
    const cap = Number(capRaw);
    if (!Number.isFinite(cap)) continue;
    map.set(code, cap);
  }

  cachedMarketCapMap = map;
  return cachedMarketCapMap;
}


function addMonths(base: Date, months: number) {
  const d = new Date(base);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function safeJson(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    return { ok: res.ok, json: text ? JSON.parse(text) : null, text };
  } catch {
    return { ok: res.ok, json: null, text };
  }
}

function redactRefreshToken(url: string) {
  try {
    const u = new URL(url);
    if (u.searchParams.has("refreshtoken")) u.searchParams.set("refreshtoken", "REDACTED");
    return u.toString();
  } catch {
    return url.replace(/refreshtoken=[^&]+/i, "refreshtoken=REDACTED");
  }
}

async function fetchWithTimeoutRetry(url: string, init: RequestInit) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err: any) {
      clearTimeout(timeout);
      lastErr = err;
      const cause = err?.cause ? ` cause=${String(err.cause)}` : "";
      console.error(
        `[scores][fetch] auth_refresh failed attempt=${attempt + 1}/3 url=${redactRefreshToken(
          url
        )} message=${String(err?.message ?? err)}${cause}`
      );
      if (attempt >= 2) break;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

async function getIdToken() {
  const refreshToken = process.env.JQUANTS_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("ENV missing: JQUANTS_REFRESH_TOKEN");

  const url = `${BASE}/token/auth_refresh?refreshtoken=${encodeURIComponent(refreshToken)}`;
  const r = await fetchWithTimeoutRetry(url, {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  const p = await safeJson(r);
  if (!p.ok) throw new Error(`auth_refresh failed: ${p.text}`);
  const idToken = String(p.json?.idToken ?? "");
  if (!idToken) throw new Error("idToken missing in auth_refresh response");
  return idToken;
}

async function fetchTradingDays(idToken: string, from: string, to: string) {
  const url = new URL(`${BASE}/markets/trading_calendar`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" },
    cache: "no-store",
  });

  const p = await safeJson(r);
  if (!p.ok) throw new Error(`trading_calendar failed: ${p.text}`);

  const rows = Array.isArray(p.json?.trading_calendar) ? p.json.trading_calendar : [];
  const days = rows
    .filter((x: any) => x && (x.HolidayDivision === "1" || x.HolidayDivision === "2"))
    .map((x: any) => String(x.Date))
    .filter(Boolean);

  days.sort();
  return days;
}

async function fetchDailyQuotesAllPages(idToken: string, date: string) {
  const all: DailyQuote[] = [];
  let paginationKey = "";
  let guard = 0;

  while (true) {
    const url = new URL(`${BASE}/prices/daily_quotes`);
    url.searchParams.set("date", date);
    if (paginationKey) url.searchParams.set("pagination_key", paginationKey);

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" },
      cache: "no-store",
    });

    const p = await safeJson(r);
    if (!p.ok) throw new Error(`daily_quotes failed (${date}): ${p.text}`);

    const qs = Array.isArray(p.json?.daily_quotes) ? p.json.daily_quotes : [];
    for (const q of qs) {
      all.push({
        Date: String(q?.Date ?? ""),
        Code: normalizeCode(String(q?.Code ?? "")),
        Open: q?.Open == null ? null : Number(q.Open),
        High: q?.High == null ? null : Number(q.High),
        Low: q?.Low == null ? null : Number(q.Low),
        Close: q?.Close == null ? null : Number(q.Close),
        Volume: q?.Volume == null ? null : Number(q.Volume),
      });
    }

    paginationKey = String(p.json?.pagination_key ?? "");
    if (!paginationKey) break;

    guard += 1;
    if (guard > 200) throw new Error("pagination too long (safety stop)");
  }

  return all;
}

async function fetchDailyQuotesByCodeAllPages(idToken: string, code: string, from: string, to: string) {
  const all: DailyQuote[] = [];
  let paginationKey = "";
  let guard = 0;

  while (true) {
    const url = new URL(`${BASE}/prices/daily_quotes`);
    url.searchParams.set("code", code);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    if (paginationKey) url.searchParams.set("pagination_key", paginationKey);

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" },
      cache: "no-store",
    });

    const p = await safeJson(r);
    if (!p.ok) throw new Error(`daily_quotes failed (${code}): ${p.text}`);

    const qs = Array.isArray(p.json?.daily_quotes) ? p.json.daily_quotes : [];
    for (const q of qs) {
      all.push({
        Date: String(q?.Date ?? ""),
        Code: normalizeCode(String(q?.Code ?? "")),
        Open: q?.Open == null ? null : Number(q.Open),
        High: q?.High == null ? null : Number(q.High),
        Low: q?.Low == null ? null : Number(q.Low),
        Close: q?.Close == null ? null : Number(q.Close),
        Volume: q?.Volume == null ? null : Number(q.Volume),
      });
    }

    paginationKey = String(p.json?.pagination_key ?? "");
    if (!paginationKey) break;

    guard += 1;
    if (guard > 200) throw new Error("pagination too long (safety stop)");
  }

  return all;
}

// 「全銘柄取り切った日付」を記録する（部分DB混入を回避）
async function ensureIngestLogTable() {
  await tursoClient.execute({
    sql: `
      CREATE TABLE IF NOT EXISTS panel_ingest_days (
        date TEXT PRIMARY KEY,
        ingested_at TEXT NOT NULL,
        rows_upserted INTEGER NOT NULL
      )
    `,
    args: [],
  });
}

async function isIngested(date: string) {
  const r = await tursoClient.execute({
    sql: `SELECT date FROM panel_ingest_days WHERE date = ?`,
    args: [date],
  });
  return (r.rows?.length ?? 0) > 0;
}

async function markIngested(date: string, rowsUpserted: number) {
  await tursoClient.execute({
    sql: `INSERT OR REPLACE INTO panel_ingest_days (date, ingested_at, rows_upserted) VALUES (?, ?, ?)`,
    args: [date, new Date().toISOString(), rowsUpserted],
  });
}

async function upsertQuotes(quotes: DailyQuote[]) {
  if (quotes.length === 0) return 0;

  const sql =
    `INSERT INTO prices_daily (code, date, open, high, low, close, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code, date) DO UPDATE SET
       open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume`;

  const CHUNK = 400;
  let upserted = 0;

  for (let i = 0; i < quotes.length; i += CHUNK) {
    const part = quotes.slice(i, i + CHUNK);

    const stmts = part
      .filter((q) => q.Code && q.Date)
      .map((q) => ({
        sql,
        args: [
          q.Code,
          q.Date,
          q.Open,
          q.High,
          q.Low,
          q.Close,
          q.Volume == null ? null : Math.round(q.Volume),
        ],
      }));

    if (stmts.length === 0) continue;

    const results = await tursoClient.batch(stmts as any, "write");
    for (const rr of results as any[]) upserted += Number(rr?.rowsAffected ?? 0);
  }

  return upserted;
}

// --- score_scan.py 相当の計算（最終日基準） ---
type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };

function mean(arr: number[]) {
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function openVolatilityRatio(bar: Bar) {
  return bar.open !== 0 ? (bar.high - bar.low) / bar.open : NaN;
}

function percentile01(values: number[]) {
  // pandas rank(pct=True, method="average") 相当（最小=1/n, 最大=1）
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const out = new Map<number, number>();
  if (n === 0) return out;

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    const rankAvg = (i + 1 + (j + 1)) / 2; // 1-index平均
    const pct = rankAvg / n;
    out.set(sorted[i], pct);
    i = j + 1;
  }
  return out;
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);

    const to = u.searchParams.get("to") ?? ymd(new Date());
    const fromParam = u.searchParams.get("from");
    const monthsBack = Math.max(1, Math.min(24, Number(u.searchParams.get("monthsBack") ?? 3)));
    const limit = Math.max(10, Math.min(500, Number(u.searchParams.get("limit") ?? 100)));
    const sync = (u.searchParams.get("sync") ?? "1") !== "0";
    const force = (u.searchParams.get("force") ?? "0") === "1";
    const marketCapRaw = u.searchParams.get("marketCap");
    const marketCapValue = Number(marketCapRaw ?? "");
    const marketCapMode = (u.searchParams.get("marketCapMode") ?? "over") as MarketCapMode;

    // score_scan.py のデフォルトに寄せる :contentReference[oaicite:4]{index=4}
    const n_vol_short = Math.max(1, Math.min(60, Number(u.searchParams.get("n_vol_short") ?? 10)));
    const n_vola = Math.max(1, Math.min(60, Number(u.searchParams.get("n_vola") ?? 10)));

    const w_openvol = Number(u.searchParams.get("w_openvol") ?? 0.25);
    const w_gap = Number(u.searchParams.get("w_gap") ?? 0.1);
    const w_spike = Number(u.searchParams.get("w_spike") ?? 0.35);
    const w_intraday = Number(u.searchParams.get("w_intraday") ?? 0.1);
    const w_volsurge = Number(u.searchParams.get("w_volsurge") ?? 0.2);
    const w_sum = Math.max(1e-9, w_openvol + w_gap + w_spike + w_intraday + w_volsurge);

    const toDate = new Date(`${to}T00:00:00`);
    if (Number.isNaN(toDate.getTime())) {
      return NextResponse.json({ ok: false, error: "invalid to (YYYY-MM-DD)" }, { status: 400 });
    }
    const fromValue = fromParam ?? ymd(addMonths(toDate, -monthsBack));
    const fromDate = new Date(`${fromValue}T00:00:00`);
    if (Number.isNaN(fromDate.getTime())) {
      return NextResponse.json({ ok: false, error: "invalid from (YYYY-MM-DD)" }, { status: 400 });
    }
    if (fromDate > toDate) {
      return NextResponse.json({ ok: false, error: "from must be <= to" }, { status: 400 });
    }
    const from = ymd(fromDate);
    const hasMarketCapFilter =
      Number.isFinite(marketCapValue) &&
      marketCapValue > 0 &&
      (marketCapMode === "over" || marketCapMode === "under");
    const marketCapMap = hasMarketCapFilter ? await loadMarketCapMapFromPublicCsv() : null;
    const allowedCodes = hasMarketCapFilter
      ? new Set(
          Array.from(marketCapMap?.entries() ?? [])
            .filter(([_, cap]) => (marketCapMode === "under" ? cap <= marketCapValue : cap >= marketCapValue))
            .map(([code]) => code)
        )
      : null;

    // --- 同期（全銘柄×営業日） ---
    const syncInfo = { requestedDays: 0, fetchedDays: 0, skippedDays: 0, quotes: 0, upserted: 0 };

    if (sync) {
      const idToken = await getIdToken();

      if (hasMarketCapFilter && allowedCodes) {
        const codes = Array.from(allowedCodes);
        syncInfo.requestedDays = codes.length;
        let fetchedCodes = 0;

        for (const code of codes) {
          const quotes = await fetchDailyQuotesByCodeAllPages(idToken, code, from, to);
          if (quotes.length > 0) fetchedCodes += 1;
          syncInfo.quotes += quotes.length;

          const up = await upsertQuotes(quotes);
          syncInfo.upserted += up;
        }
        syncInfo.fetchedDays = fetchedCodes;
      } else {
        await ensureIngestLogTable();
        const days = await fetchTradingDays(idToken, from, to);
        syncInfo.requestedDays = days.length;

        for (const d of days) {
          if (!force && (await isIngested(d))) {
            syncInfo.skippedDays++;
            continue;
          }
          const quotes = await fetchDailyQuotesAllPages(idToken, d);
          syncInfo.fetchedDays++;
          syncInfo.quotes += quotes.length;

          const up = await upsertQuotes(quotes);
          syncInfo.upserted += up;
          await markIngested(d, up);
        }
      }
    }

    // --- DBから期間分を取得して、銘柄ごとに score_scan.py と同じ計算 ---
    const res = await tursoClient.execute({
      sql: `
        SELECT code, date, open, high, low, close, volume
        FROM prices_daily
        WHERE date >= ? AND date <= ?
        ORDER BY code, date
      `,
      args: [from, to],
    });

    const byCode = new Map<string, Bar[]>();
    for (const r of res.rows as any[]) {
      const code = normalizeCode(String(r.code ?? ""));
      if (!code) continue;
      if (allowedCodes && !allowedCodes.has(code)) continue;

      const open = Number(r.open);
      const high = Number(r.high);
      const low = Number(r.low);
      const close = Number(r.close);
      const volume = r.volume == null ? NaN : Number(r.volume);

      // Python同様、欠損は除外 :contentReference[oaicite:5]{index=5}
      if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(volume)) continue;
      if (open === 0) continue;

      const arr = byCode.get(code) ?? [];
      arr.push({ date: String(r.date), open, high, low, close, volume });
      byCode.set(code, arr);
    }

    const metrics: Array<{
      code: string;
      open_volatility_ratio: number;
      gap_ratio: number;
      volatility_spike_ratio: number;
      intraday_momentum: number;
      volume_surge_today: number;
    }> = [];

    for (const [code, bars] of byCode.entries()) {
      bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      const need = Math.max(n_vola + 1, n_vol_short + 1, 2);
      if (bars.length < need) continue;

      const last = bars[bars.length - 1];
      const prev = bars[bars.length - 2];

      const openVol = openVolatilityRatio(last);
      const gapRatio = prev.close !== 0 ? (last.open - prev.close) / prev.close : NaN;
      const intradayMomentum = last.open !== 0 ? (last.close - last.open) / last.open : NaN;

      const prevVols = bars
        .slice(Math.max(0, bars.length - 1 - n_vola), bars.length - 1)
        .map(openVolatilityRatio);
      const prevVolMean = mean(prevVols);
      const volatilitySpikeRatio = Number.isFinite(prevVolMean) && prevVolMean !== 0 ? openVol / prevVolMean : NaN;

      const prevVolumes = bars
        .slice(Math.max(0, bars.length - 1 - n_vol_short), bars.length - 1)
        .map((b) => b.volume);
      const prevVolumeMean = mean(prevVolumes);
      const volumeSurgeToday =
        Number.isFinite(prevVolumeMean) && prevVolumeMean !== 0 ? last.volume / prevVolumeMean : NaN;

      metrics.push({
        code,
        open_volatility_ratio: openVol,
        gap_ratio: gapRatio,
        volatility_spike_ratio: volatilitySpikeRatio,
        intraday_momentum: intradayMomentum,
        volume_surge_today: volumeSurgeToday,
      });
    }

    const openVolVals = metrics.map((m) => m.open_volatility_ratio).filter((v) => Number.isFinite(v));
    const gapVals = metrics.map((m) => m.gap_ratio).filter((v) => Number.isFinite(v));
    const spikeVals = metrics.map((m) => m.volatility_spike_ratio).filter((v) => Number.isFinite(v));
    const intradayVals = metrics.map((m) => m.intraday_momentum).filter((v) => Number.isFinite(v));
    const volSurgeVals = metrics.map((m) => m.volume_surge_today).filter((v) => Number.isFinite(v));

    const pOpenVol = percentile01(openVolVals);
    const pGap = percentile01(gapVals);
    const pSpike = percentile01(spikeVals);
    const pIntraday = percentile01(intradayVals);
    const pVolSurge = percentile01(volSurgeVals);

    const items = metrics
      .map((m) => {
        const openVolNorm = pOpenVol.get(m.open_volatility_ratio) ?? 0;
        const gapNorm = pGap.get(m.gap_ratio) ?? 0;
        const spikeNorm = pSpike.get(m.volatility_spike_ratio) ?? 0;
        const intradayNorm = pIntraday.get(m.intraday_momentum) ?? 0;
        const volSurgeNorm = pVolSurge.get(m.volume_surge_today) ?? 0;

        const score =
          (w_openvol * openVolNorm +
            w_gap * gapNorm +
            w_spike * spikeNorm +
            w_intraday * intradayNorm +
            w_volsurge * volSurgeNorm) /
          w_sum;

        return {
          code: m.code,
          score,
          open_volatility_ratio: m.open_volatility_ratio,
          gap_ratio: m.gap_ratio,
          volatility_spike_ratio: m.volatility_spike_ratio,
          intraday_momentum: m.intraday_momentum,
          volume_surge_today: m.volume_surge_today,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x, i) => ({ rank: i + 1, ...x }));

    return NextResponse.json({
      ok: true,
      range: { from, to },
      params: {
        from,
        to,
        monthsBack: fromParam ? null : monthsBack,
        marketCap: hasMarketCapFilter ? marketCapValue : null,
        marketCapMode: hasMarketCapFilter ? marketCapMode : null,
        n_vol_short,
        n_vola,
        weights: { w_openvol, w_gap, w_spike, w_intraday, w_volsurge },
      },
      sync: syncInfo,
      universe: { barsInDb: (res.rows as any[]).length, scoredCodes: metrics.length },
      items,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

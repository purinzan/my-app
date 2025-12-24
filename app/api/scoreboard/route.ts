import { NextResponse } from "next/server";
import dns from "dns";
import { tursoClient } from "@/lib/db";
import path from "path";
import { readFile } from "fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.jquants.com/v1";
dns.setDefaultResultOrder("ipv4first");

type DailyQuote = {
  Date: string;
  Code: string;
  Open: number | null;
  High: number | null;
  Low: number | null;
  Close: number | null;
  Volume: number | null;
};

type CompanyRow = Record<string, string>;
type MarketCapMode = "over" | "under";

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addMonths(base: Date, months: number) {
  const d = new Date(base);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function normalizeCode(anyCode: string) {
  // "6740", "6740.0", "6740-T", "TSE:6740" などから 4桁抽出
  const s = String(anyCode ?? "").trim();
  const m = s.match(/(\d{4})/);
  return m ? m[1] : "";
}

async function safeJson(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const json = text ? JSON.parse(text) : null;
    return { ok: res.ok, json, text };
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

async function fetchWithLog(url: string, init: RequestInit, label: string, debug: boolean) {
  try {
    return await fetch(url, init);
  } catch (e: any) {
    if (debug) {
      console.error(
        `[scoreboard][fetch] ${label} network error url=${redactRefreshToken(url)} message=${String(e?.message ?? e)}`
      );
    }
    throw e;
  }
}

async function fetchWithTimeoutRetry(
  url: string,
  init: RequestInit,
  opts: { retries: number; timeoutMs: number; label: string; debug: boolean }
) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err: any) {
      clearTimeout(timeout);
      lastErr = err;
      const cause = err?.cause ? ` cause=${String(err.cause)}` : "";
      console.error(
        `[scoreboard][fetch] ${opts.label} failed attempt=${attempt + 1}/${opts.retries + 1} url=${redactRefreshToken(
          url
        )} message=${String(err?.message ?? err)}${cause}`
      );
      if (attempt >= opts.retries) break;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
}

async function getIdToken(debug: boolean) {
  const refreshToken = process.env.JQUANTS_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("ENV missing: JQUANTS_REFRESH_TOKEN");

  const url = `${BASE}/token/auth_refresh?refreshtoken=${encodeURIComponent(refreshToken)}`;
  const r = await fetchWithTimeoutRetry(
    url,
    {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    },
    { retries: 2, timeoutMs: 10000, label: "auth_refresh", debug }
  );

  const p = await safeJson(r);
  if (!p.ok) {
    if (debug) {
      console.error(
        `[scoreboard][fetch] auth_refresh bad status=${r.status} body=${p.text.slice(0, 200)}`
      );
    }
    throw new Error(`auth_refresh failed: ${p.text}`);
  }
  const idToken = String(p.json?.idToken ?? "");
  if (!idToken) throw new Error("idToken missing in auth_refresh response");
  return idToken;
}

async function fetchTradingDays(idToken: string, from: string, to: string, debug: boolean) {
  const url = new URL(`${BASE}/markets/trading_calendar`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const r = await fetchWithLog(url.toString(), {
    headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" },
    cache: "no-store",
  }, "trading_calendar", debug);

  const p = await safeJson(r);
  if (!p.ok) {
    if (debug) {
      console.error(
        `[scoreboard][fetch] trading_calendar bad status=${r.status} body=${p.text.slice(0, 200)}`
      );
    }
    throw new Error(`trading_calendar failed: ${p.text}`);
  }

  const rows = Array.isArray(p.json?.trading_calendar) ? p.json.trading_calendar : [];
  const days = rows
    .filter((x: any) => x && (x.HolidayDivision === "1" || x.HolidayDivision === "2"))
    .map((x: any) => String(x.Date))
    .filter(Boolean);

  days.sort();
  return days;
}

async function fetchDailyQuotesAllPages(idToken: string, date: string, debug: boolean) {
  const all: DailyQuote[] = [];
  let paginationKey = "";
  let guard = 0;

  while (true) {
    const url = new URL(`${BASE}/prices/daily_quotes`);
    url.searchParams.set("date", date);
    if (paginationKey) url.searchParams.set("pagination_key", paginationKey);

    const r = await fetchWithLog(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" },
      cache: "no-store",
    }, `daily_quotes ${date}`, debug);

    const p = await safeJson(r);
    if (!p.ok) {
      if (debug) {
        console.error(
          `[scoreboard][fetch] daily_quotes bad status=${r.status} date=${date} body=${p.text.slice(0, 200)}`
        );
      }
      throw new Error(`daily_quotes failed (${date}): ${p.text}`);
    }

    const qs = Array.isArray(p.json?.daily_quotes) ? p.json.daily_quotes : [];
    for (const q of qs) {
      const code = normalizeCode(String(q?.Code ?? ""));
      const dt = String(q?.Date ?? "");
      if (!code || !dt) continue;

      all.push({
        Date: dt,
        Code: code,
        Open: q?.Open == null ? null : Number(q.Open),
        High: q?.High == null ? null : Number(q.High),
        Low: q?.Low == null ? null : Number(q.Low),
        Close: q?.Close == null ? null : Number(q.Close),
        Volume: q?.Volume == null ? null : Number(q.Volume),
      });
    }

    paginationKey = String(p.json?.pagination_key ?? "");
    if (!paginationKey) break;

    guard++;
    if (guard > 300) throw new Error("pagination too long (safety stop)");
  }

  return all;
}

async function fetchDailyQuotesByCodeAllPages(
  idToken: string,
  code: string,
  from: string,
  to: string,
  debug: boolean
) {
  const all: DailyQuote[] = [];
  let paginationKey = "";
  let guard = 0;

  while (true) {
    const url = new URL(`${BASE}/prices/daily_quotes`);
    url.searchParams.set("code", code);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    if (paginationKey) url.searchParams.set("pagination_key", paginationKey);

    const r = await fetchWithLog(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" },
      cache: "no-store",
    }, `daily_quotes ${code} ${from}-${to}`, debug);

    const p = await safeJson(r);
    if (!p.ok) {
      if (debug) {
        console.error(
          `[scoreboard][fetch] daily_quotes bad status=${r.status} code=${code} body=${p.text.slice(0, 200)}`
        );
      }
      throw new Error(`daily_quotes failed (${code}): ${p.text}`);
    }

    const qs = Array.isArray(p.json?.daily_quotes) ? p.json.daily_quotes : [];
    for (const q of qs) {
      const c = normalizeCode(String(q?.Code ?? ""));
      const dt = String(q?.Date ?? "");
      if (!c || !dt) continue;

      all.push({
        Date: dt,
        Code: c,
        Open: q?.Open == null ? null : Number(q.Open),
        High: q?.High == null ? null : Number(q.High),
        Low: q?.Low == null ? null : Number(q.Low),
        Close: q?.Close == null ? null : Number(q.Close),
        Volume: q?.Volume == null ? null : Number(q.Volume),
      });
    }

    paginationKey = String(p.json?.pagination_key ?? "");
    if (!paginationKey) break;

    guard++;
    if (guard > 200) throw new Error("pagination too long (safety stop)");
  }

  return all;
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: R[] = [];
  let nextIndex = 0;

  async function runOne() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => runOne());
  await Promise.all(workers);
  return results;
}

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

    const stmts = part.map((q) => ({
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

    const results = await tursoClient.batch(stmts as any, "write");
    for (const rr of results as any[]) upserted += Number(rr?.rowsAffected ?? 0);
  }

  return upserted;
}

// ========= listed_info.csv（public）をサーバー側で読む =========

function detectDelimiter(line: string) {
  const tab = (line.match(/\t/g) ?? []).length;
  const comma = (line.match(/,/g) ?? []).length;
  return tab > comma ? "\t" : ",";
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

// モジュールキャッシュ（devでもOK、再起動でリセット）
let cachedCompanyMap: Map<string, CompanyRow> | null = null;

async function loadCompanyMapFromPublicCsv() {
  if (cachedCompanyMap) return cachedCompanyMap;

  const csvPath = path.join(process.cwd(), "public", "listed_info.csv");
  let buf: Buffer;
  try {
    buf = await readFile(csvPath);
  } catch (e: unknown) {
    console.error(`[scoreboard] failed to read listed_info.csv: ${String((e as Error)?.message ?? e)}`);
    cachedCompanyMap = new Map();
    return cachedCompanyMap;
  }

  let text = buf.toString("utf8").replace(/^\ufeff/, "");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  const lines = text.split("\n").filter(Boolean);
  if (lines.length < 2) {
    cachedCompanyMap = new Map();
    return cachedCompanyMap;
  }

  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.replace(/^"|"$/g, "").trim());

  const idxCode = headers.indexOf("Code"); // あれば使う
  const hasCodeHeader = idxCode >= 0;

  const map = new Map<string, CompanyRow>();

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i], delim).map((v) => v.replace(/^"|"$/g, "").trim());

    // 要件：2列目に銘柄コード（ただし "Code" ヘッダがあるならそれを優先）
    const codeCell = hasCodeHeader ? (cols[idxCode] ?? "") : (cols[1] ?? "");
    const code = normalizeCode(codeCell);
    if (!code) continue;

    const row: CompanyRow = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col${c + 1}`;
      row[key] = String(cols[c] ?? "");
    }
    map.set(code, row);
  }

  cachedCompanyMap = map;
  return cachedCompanyMap;
}

// ========= score =========

type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };

function mean(arr: number[]) {
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function openVolatilityRatio(bar: Bar) {
  return bar.open !== 0 ? (bar.high - bar.low) / bar.open : NaN;
}

function percentile01(values: number[]) {
  // pandasの rank(pct=True, method="average") 的（最小>0、最大=1）
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const out = new Map<number, number>();
  if (n === 0) return out;

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    const rankAvg = (i + 1 + (j + 1)) / 2; // 1-index average rank
    out.set(sorted[i], rankAvg / n);
    i = j + 1;
  }
  return out;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const debug = u.searchParams.get("debug") === "1";

  const dbg: any = {};
  const log = (...args: any[]) => {
    if (debug) console.log(...args);
  };

  try {
    const to = u.searchParams.get("to") ?? ymd(new Date());
    const fromParam = u.searchParams.get("from");
    const monthsBack = Math.max(1, Math.min(24, Number(u.searchParams.get("monthsBack") ?? 3)));
    const limit = Math.max(10, Math.min(500, Number(u.searchParams.get("limit") ?? 100)));
    const sync = (u.searchParams.get("sync") ?? "1") !== "0";
    const force = (u.searchParams.get("force") ?? "0") === "1";
    const marketCapRaw = u.searchParams.get("marketCap");
    const marketCapValue = Number(marketCapRaw ?? "");
    const marketCapMode = (u.searchParams.get("marketCapMode") ?? "over") as MarketCapMode;

    // score_scan.py 既定に寄せる
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

    if (debug) {
      dbg.params = {
        to,
        from,
        monthsBack: fromParam ? null : monthsBack,
        limit,
        sync,
        force,
        marketCap: hasMarketCapFilter ? marketCapValue : null,
        marketCapMode: hasMarketCapFilter ? marketCapMode : null,
        n_vol_short,
        n_vola,
        w_openvol,
        w_gap,
        w_spike,
        w_intraday,
        w_volsurge,
      };
    }
    log(
      `[scoreboard] request from=${from} to=${to} sync=${sync} force=${force} limit=${limit} marketCap=${hasMarketCapFilter ? marketCapValue : "none"}`
    );

    // 会社マスタ
    const companyMap = await loadCompanyMapFromPublicCsv();
    let allowedCodes: Set<string> | null = null;
    if (hasMarketCapFilter) {
      const mode = marketCapMode === "under" ? "under" : "over";
      allowedCodes = new Set<string>();
      for (const [code, row] of companyMap.entries()) {
        const raw = row["MarketCap"];
        const cap = raw == null || raw === "" ? NaN : Number(raw);
        if (!Number.isFinite(cap)) continue;
        if (mode === "under" ? cap <= marketCapValue : cap >= marketCapValue) {
          allowedCodes.add(code);
        }
      }
      log(`[scoreboard][filter] marketCap ${mode} ${marketCapValue} -> codes=${allowedCodes.size}`);
    }

    // 同期（全銘柄×営業日）
    const syncInfo = { requestedDays: 0, fetchedDays: 0, skippedDays: 0, quotes: 0, upserted: 0 };

    if (sync) {
      const idToken = await getIdToken(debug);

      if (hasMarketCapFilter && allowedCodes) {
        const codes = Array.from(allowedCodes);
        syncInfo.requestedDays = codes.length;
        log(`[scoreboard][sync] codes=${codes.length} from=${from} to=${to}`);

        let fetchedCodes = 0;
        const errors: string[] = [];
        const concurrency = 6;

        await runWithConcurrency(codes, concurrency, async (code, index) => {
          try {
            const quotes = await fetchDailyQuotesByCodeAllPages(idToken, code, from, to, debug);
            if (quotes.length > 0) fetchedCodes += 1;
            syncInfo.quotes += quotes.length;

            const up = await upsertQuotes(quotes);
            syncInfo.upserted += up;
            log(`[scoreboard][sync] code=${code} fetched=${quotes.length} upserted=${up}`);
          } catch (e: any) {
            syncInfo.skippedDays += 1;
            const msg = String(e?.message ?? e);
            errors.push(`${code}:${msg}`);
            console.error(`[scoreboard][sync] code=${code} failed message=${msg}`);
          } finally {
            if ((index + 1) % 200 === 0) {
              log(`[scoreboard][sync] progress ${index + 1}/${codes.length}`);
            }
          }
          return null;
        });

        syncInfo.fetchedDays = fetchedCodes;
        if (errors.length && debug) dbg.syncErrors = errors.slice(0, 200);
      } else {
        await ensureIngestLogTable();
        const days = await fetchTradingDays(idToken, from, to, debug);
        syncInfo.requestedDays = days.length;
        log(`[scoreboard][sync] days=${days.length} from=${from} to=${to}`);

        if (debug) dbg.tradingDays = { requestedDays: days.length, first: days[0], last: days[days.length - 1] };

        for (const d of days) {
          if (!force && (await isIngested(d))) {
            syncInfo.skippedDays++;
            continue;
          }

          const quotes = await fetchDailyQuotesAllPages(idToken, d, debug);
          syncInfo.fetchedDays++;
          syncInfo.quotes += quotes.length;

          const up = await upsertQuotes(quotes);
          syncInfo.upserted += up;
          log(`[scoreboard][sync] date=${d} fetched=${quotes.length} upserted=${up}`);

          await markIngested(d, up);
        }
      }
    }

    // DBから期間の全行を取得
    const res = await tursoClient.execute({
      sql: `
        SELECT code, date, open, high, low, close, volume
        FROM prices_daily
        WHERE date >= ? AND date <= ?
        ORDER BY code, date
      `,
      args: [from, to],
    });
    log(`[scoreboard][db] rows=${(res.rows as any[]).length}`);

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

      // 欠損は除外
      if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(volume)) continue;
      if (open === 0) continue;

      const arr = byCode.get(code) ?? [];
      arr.push({ date: String(r.date), open, high, low, close, volume });
      byCode.set(code, arr);
    }

    // 指標計算
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

      if (
        ![openVol, gapRatio, volatilitySpikeRatio, intradayMomentum, volumeSurgeToday].every((v) =>
          Number.isFinite(v)
        )
      ) {
        continue;
      }

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

    let missingCompanyInTop = 0;
    log(`[scoreboard][compute] codesWithBars=${byCode.size} scoredCodes=${metrics.length}`);

    const ranked = metrics
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

        const company = companyMap.get(m.code) ?? null;

        return {
          code: m.code,
          company,
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
      .map((x, i) => {
        if (!x.company) missingCompanyInTop++;
        return { rank: i + 1, ...x };
      });

    const payload: any = {
      ok: true,
      range: { from, to },
      params: {
        from,
        to,
        monthsBack: fromParam ? null : monthsBack,
        limit,
        sync,
        force,
        marketCap: hasMarketCapFilter ? marketCapValue : null,
        marketCapMode: hasMarketCapFilter ? marketCapMode : null,
        n_vol_short,
        n_vola,
        weights: { w_openvol, w_gap, w_spike, w_intraday, w_volsurge },
      },
      sync: syncInfo,
      universe: {
        barsInDb: (res.rows as any[]).length,
        codesWithBars: byCode.size,
        scoredCodes: metrics.length,
      },
      company: {
        loaded: companyMap.size,
        missingCompanyInTop,
      },
      items: ranked,
    };

    if (debug) {
      dbg.summary = {
        syncInfo,
        dbRows: (res.rows as any[]).length,
        codesWithBars: byCode.size,
        scoredCodes: metrics.length,
        top3: ranked.slice(0, 3).map((x: any) => ({ code: x.code, score: x.score })),
      };
      payload.debug = dbg;
    }

    return NextResponse.json(payload);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return NextResponse.json({ ok: false, error: msg, ...(debug ? { debug: dbg } : {}) }, { status: 500 });
  }
}

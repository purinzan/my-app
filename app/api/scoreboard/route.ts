import { NextResponse } from "next/server";
import { tursoClient } from "@/lib/db";
import path from "path";
import { readFile } from "fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = "https://api.jquants.com/v1";

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

async function getIdToken() {
  const refreshToken = process.env.JQUANTS_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("ENV missing: JQUANTS_REFRESH_TOKEN");

  const r = await fetch(`${BASE}/token/auth_refresh?refreshtoken=${encodeURIComponent(refreshToken)}`, {
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

  try {
    const to = u.searchParams.get("to") ?? ymd(new Date());
    const monthsBack = Math.max(1, Math.min(24, Number(u.searchParams.get("monthsBack") ?? 3)));
    const limit = Math.max(10, Math.min(500, Number(u.searchParams.get("limit") ?? 100)));
    const sync = (u.searchParams.get("sync") ?? "1") !== "0";
    const force = (u.searchParams.get("force") ?? "0") === "1";

    // score_scan.py 既定に寄せる
    const n_ret = Math.max(1, Number(u.searchParams.get("n_ret") ?? 9));
    const n_vol_short = Math.max(1, Number(u.searchParams.get("n_vol_short") ?? 10));
    const n_vol_long = Math.max(1, Number(u.searchParams.get("n_vol_long") ?? 60));
    const n_vola = Math.max(1, Number(u.searchParams.get("n_vola") ?? 10));
    const n_mom = Math.max(1, Number(u.searchParams.get("n_mom") ?? 3));

    const w_ret = Number(u.searchParams.get("w_ret") ?? 0.35);
    const w_volchg = Number(u.searchParams.get("w_volchg") ?? 0.25);
    const w_volat = Number(u.searchParams.get("w_volat") ?? 0.2);
    const w_mom = Number(u.searchParams.get("w_mom") ?? 0.2);
    const w_sum = Math.max(1e-9, w_ret + w_volchg + w_volat + w_mom);

    const toDate = new Date(`${to}T00:00:00`);
    if (Number.isNaN(toDate.getTime())) {
      return NextResponse.json({ ok: false, error: "invalid to (YYYY-MM-DD)" }, { status: 400 });
    }
    const from = ymd(addMonths(toDate, -monthsBack));

    if (debug) {
      dbg.params = { to, from, monthsBack, limit, sync, force, n_ret, n_vol_short, n_vol_long, n_vola, n_mom, w_ret, w_volchg, w_volat, w_mom };
    }

    // 会社マスタ
    const companyMap = await loadCompanyMapFromPublicCsv();

    // 同期（全銘柄×営業日）
    const syncInfo = { requestedDays: 0, fetchedDays: 0, skippedDays: 0, quotes: 0, upserted: 0 };

    if (sync) {
      await ensureIngestLogTable();
      const idToken = await getIdToken();

      const days = await fetchTradingDays(idToken, from, to);
      syncInfo.requestedDays = days.length;

      if (debug) dbg.tradingDays = { requestedDays: days.length, first: days[0], last: days[days.length - 1] };

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

    const byCode = new Map<string, Bar[]>();

    for (const r of res.rows as any[]) {
      const code = normalizeCode(String(r.code ?? ""));
      if (!code) continue;

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
      ret_mean: number;
      volchg_ratio: number;
      volat_rto_mean: number;
      mom_n_days: number;
    }> = [];

    for (const [code, bars] of byCode.entries()) {
      bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      const need = Math.max(n_ret + 1, n_mom + 1, n_vol_short + 1, 10);
      if (bars.length < need) continue;

      // ret_mean
      const rets: number[] = [];
      for (let i = 1; i < bars.length; i++) {
        const prev = bars[i - 1].close;
        const cur = bars[i].close;
        if (prev !== 0) rets.push(cur / prev - 1);
      }
      const ret_mean = mean(rets.slice(-n_ret));

      // volchg_ratio
      const vols = bars.map((b) => b.volume);
      const short = mean(vols.slice(-n_vol_short));
      const ex = vols.slice(0, Math.max(0, vols.length - n_vol_short));
      const long = mean(ex.slice(-Math.min(n_vol_long, ex.length)));
      const volchg_ratio = Number.isFinite(long) && long !== 0 ? short / long : NaN;

      // volat_rto_mean
      const rto = bars.map((b) => (b.high - b.low) / b.open);
      const volat_rto_mean = mean(rto.slice(-n_vola));

      // mom_n_days
      const last = bars[bars.length - 1].close;
      const prev = bars[bars.length - 1 - n_mom].close;
      const mom_n_days = prev !== 0 ? last / prev - 1 : NaN;

      if (![ret_mean, volchg_ratio, volat_rto_mean, mom_n_days].every((v) => Number.isFinite(v))) continue;

      metrics.push({ code, ret_mean, volchg_ratio, volat_rto_mean, mom_n_days });
    }

    const retVals = metrics.map((m) => m.ret_mean).filter((v) => Number.isFinite(v));
    const volchgVals = metrics.map((m) => m.volchg_ratio).filter((v) => Number.isFinite(v));
    const volatVals = metrics.map((m) => m.volat_rto_mean).filter((v) => Number.isFinite(v));
    const momVals = metrics.map((m) => m.mom_n_days).filter((v) => Number.isFinite(v));

    const pRet = percentile01(retVals);
    const pVolchg = percentile01(volchgVals);
    const pVolat = percentile01(volatVals);
    const pMom = percentile01(momVals);

    let missingCompanyInTop = 0;

    const ranked = metrics
      .map((m) => {
        const ret_norm = pRet.get(m.ret_mean) ?? 0;
        const volchg_norm = pVolchg.get(m.volchg_ratio) ?? 0;
        const volat_norm = pVolat.get(m.volat_rto_mean) ?? 0;
        const mom_norm = pMom.get(m.mom_n_days) ?? 0;

        const score = (w_ret * ret_norm + w_volchg * volchg_norm + w_volat * volat_norm + w_mom * mom_norm) / w_sum;

        const company = companyMap.get(m.code) ?? null;

        return {
          code: m.code,
          company,
          score,
          ret_mean: m.ret_mean,
          volchg_ratio: m.volchg_ratio,
          volat_rto_mean: m.volat_rto_mean,
          mom_n_days: m.mom_n_days,
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
        monthsBack,
        limit,
        sync,
        force,
        n_ret,
        n_vol_short,
        n_vol_long,
        n_vola,
        n_mom,
        weights: { w_ret, w_volchg, w_volat, w_mom },
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

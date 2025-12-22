import { NextRequest, NextResponse } from "next/server";
import { connect } from "@/lib/db";

export const runtime = "nodejs";

const JQUANTS_BASE = "https://api.jquants.com/v1";

function normalizeStockCode(raw: string) {
  const s = String(raw ?? "").trim();
  if (s.length === 5 && s.endsWith("0")) return s.slice(0, -1);
  return s;
}

async function safeJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) throw new Error(`空のレスポンス (HTTP ${res.status})`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`JSON解析失敗 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function getIdTokenFromRefresh(refreshToken: string) {
  const url = new URL(`${JQUANTS_BASE}/token/auth_refresh`);
  url.searchParams.set("refreshtoken", refreshToken);

  const res = await fetch(url.toString(), { method: "POST", cache: "no-store" });
  const json = await safeJson<{ idToken?: string; message?: string }>(res);
  if (!res.ok || !json.idToken) throw new Error(json.message || `idToken取得失敗 (HTTP ${res.status})`);
  return json.idToken;
}

async function fetchTradingDays(idToken: string, from: string, to: string): Promise<string[]> {
  const url = new URL(`${JQUANTS_BASE}/markets/trading_calendar`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });

  const json = await safeJson<{ trading_calendar?: { Date: string; HolidayDivision: string }[]; message?: string }>(res);
  if (!res.ok || !json.trading_calendar) throw new Error(json.message || `trading_calendar取得失敗 (HTTP ${res.status})`);

  // 現物株は "1"(営業日) / "2"(半日) を対象にするのが一般的
  return json.trading_calendar
    .filter((d) => d.HolidayDivision === "1" || d.HolidayDivision === "2")
    .map((d) => d.Date);
}

type DailyQuote = {
  Date: string;
  Code: string;
  Open: number | null;
  High: number | null;
  Low: number | null;
  Close: number | null;
  Volume: number | null;
  pagination_key?: string;
};

async function fetchDailyQuotesByDate(idToken: string, date: string): Promise<DailyQuote[]> {
  let all: DailyQuote[] = [];
  let paginationKey: string | null = null;

  for (let guard = 0; guard < 200; guard++) {
    const url = new URL(`${JQUANTS_BASE}/prices/daily_quotes`);
    url.searchParams.set("date", date);
    if (paginationKey) url.searchParams.set("pagination_key", paginationKey);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });

    const json = await safeJson<{ daily_quotes?: DailyQuote[]; pagination_key?: string; message?: string }>(res);
    if (!res.ok || !json.daily_quotes) throw new Error(json.message || `daily_quotes取得失敗 (HTTP ${res.status})`);

    all = all.concat(json.daily_quotes);
    const next = json.pagination_key ?? null;

    if (!next || next === paginationKey) break;
    paginationKey = next;
  }

  return all;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: NextRequest) {
  const t0 = performance.now();

  try {
    const url = new URL(req.url);
    const from = url.searchParams.get("from")?.trim() || "";
    const to = url.searchParams.get("to")?.trim() || "";
    const cursor = (url.searchParams.get("cursor")?.trim() || from) as string;
    const batchDays = Math.max(1, Math.min(10, Number(url.searchParams.get("batchDays") || "5")));

    if (!from || !to) {
      return NextResponse.json({ ok: false, error: "from/to は必須です" }, { status: 400 });
    }

    const refreshToken = process.env.JQUANTS_REFRESH_TOKEN;
    if (!refreshToken) {
      return NextResponse.json({ ok: false, error: "ENV: JQUANTS_REFRESH_TOKEN が未設定です" }, { status: 500 });
    }

    const idToken = await getIdTokenFromRefresh(refreshToken);
    const tradingDays = await fetchTradingDays(idToken, cursor, to);
    const slice = tradingDays.slice(0, batchDays);

    const db = connect();

    let rowsFetched = 0;
    let rowsUpserted = 0;

    for (const day of slice) {
      const quotes = await fetchDailyQuotesByDate(idToken, day);
      rowsFetched += quotes.length;

      // 必須値が揃っているものだけ
      const cleaned = quotes
        .map((q) => ({
          code: normalizeStockCode(q.Code),
          date: q.Date,
          open: q.Open,
          high: q.High,
          low: q.Low,
          close: q.Close,
          volume: q.Volume,
        }))
        .filter((q) => q.code && q.date && q.open != null && q.high != null && q.low != null && q.close != null);

      // Upsert（SQLサイズ制限回避のため分割）
      for (const part of chunk(cleaned, 250)) {
        const placeholders = part.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
        const sql = `
          INSERT INTO prices_daily (code, date, open, high, low, close, volume)
          VALUES ${placeholders}
          ON CONFLICT(code, date) DO UPDATE SET
            open=excluded.open,
            high=excluded.high,
            low=excluded.low,
            close=excluded.close,
            volume=excluded.volume
        `;

        const args: any[] = [];
        for (const r of part) {
          args.push(r.code, r.date, r.open, r.high, r.low, r.close, r.volume);
        }

        await db.execute({ sql, args });
        rowsUpserted += part.length;
      }
    }

    const nextCursor = tradingDays.length > slice.length ? tradingDays[slice.length] : null;

    return NextResponse.json({
      ok: true,
      from,
      to,
      cursor,
      batchDays,
      processedDates: slice,
      rowsFetched,
      rowsUpserted,
      nextCursor,
      ms: Math.round(performance.now() - t0),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "error" },
      { status: 500 }
    );
  }
}

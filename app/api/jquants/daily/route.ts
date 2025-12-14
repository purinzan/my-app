import { NextResponse } from "next/server";
import { tursoClient, db } from "@/lib/db/client";
import { pricesDaily } from "@/lib/db/schema";

const BASE = "https://api.jquants.com/v1";

/**
 * env 必須:
 * - JQUANTS_REFRESH_TOKEN
 * - TURSO_DATABASE_URL
 * - TURSO_AUTH_TOKEN
 *
 * schema.ts で pricesDaily を定義している前提:
 * code(text), date(text), open(real), high(real), low(real), close(real), volume(integer)
 * PK: (code, date)
 */

async function ensurePricesDailyTable() {
  // マイグレーション整備前の「まず動かす」用：無ければ作る
  await tursoClient.execute(`
    CREATE TABLE IF NOT EXISTS prices_daily (
      code TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume INTEGER,
      PRIMARY KEY (code, date)
    );
  `);
}

async function getIdToken(refreshToken: string) {
  const url = new URL(`${BASE}/token/auth_refresh`);
  url.searchParams.set("refreshtoken", refreshToken);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`auth_refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { idToken: string };
  if (!data?.idToken) throw new Error("auth_refresh: missing idToken");
  return data.idToken;
}

type JqDailyQuote = {
  Date?: string; // "YYYY-MM-DD"
  Open?: number;
  High?: number;
  Low?: number;
  Close?: number;
  Volume?: number;

  // APIやプラン/レスポンス差異吸収（保険）
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

function toISODate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // ざっくり "YYYY-MM-DD" だけ通す
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const code = searchParams.get("code");
    const date = searchParams.get("date"); // 例: 2025-12-12（営業日推奨）
    const from = searchParams.get("from"); // 例: 2025-12-01
    const to = searchParams.get("to");     // 例: 2025-12-31

    if (!code) {
      return NextResponse.json({ ok: false, error: "missing code" }, { status: 400 });
    }

    const refreshToken = process.env.JQUANTS_REFRESH_TOKEN;
    if (!refreshToken) {
      return NextResponse.json({ ok: false, error: "missing JQUANTS_REFRESH_TOKEN" }, { status: 500 });
    }

    // 先にテーブルを用意
    await ensurePricesDailyTable();

    // idToken取得
    const idToken = await getIdToken(refreshToken);

    // daily_quotes 呼び出し
    const url = new URL(`${BASE}/prices/daily_quotes`);
    url.searchParams.set("code", code);

    // 優先順位：from/to → date → なし
    const fromISO = toISODate(from);
    const toISO = toISODate(to);
    const dateISO = toISODate(date);

    if (fromISO) url.searchParams.set("from", fromISO);
    if (toISO) url.searchParams.set("to", toISO);
    if (!fromISO && !toISO && dateISO) url.searchParams.set("date", dateISO);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `daily_quotes failed: ${res.status}`, detail: await res.text() },
        { status: 500 }
      );
    }

    const data = (await res.json()) as { daily_quotes?: JqDailyQuote[] };
    const quotes = Array.isArray(data?.daily_quotes) ? data.daily_quotes : [];

    // DB保存用に整形
    const rows = quotes
      .map((q) => {
        const d = toISODate(q.Date ?? q.date);
        if (!d) return null;

        return {
          code: String(code),
          date: d,
          open: (q.Open ?? q.open ?? null) as number | null,
          high: (q.High ?? q.high ?? null) as number | null,
          low: (q.Low ?? q.low ?? null) as number | null,
          close: (q.Close ?? q.close ?? null) as number | null,
          volume: (q.Volume ?? q.volume ?? null) as number | null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // 既にある (code,date) は無視してINSERT
    if (rows.length > 0) {
      await db.insert(pricesDaily).values(rows).onConflictDoNothing();
    }

    return NextResponse.json({
      ok: true,
      code,
      query: {
        date: dateISO ?? null,
        from: fromISO ?? null,
        to: toISO ?? null,
      },
      fetched: quotes.length,
      saved: rows.length,
      sample: rows.slice(0, 3),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}

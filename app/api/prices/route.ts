// app/api/prices/route.ts
import { NextResponse } from "next/server";
import { tursoClient } from "@/lib/db";
import { syncDailyQuotesToDB } from "@/lib/jquants";

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clampRange(from?: string | null, to?: string | null) {
  // from/to が空なら直近180日
  if (from && to) return { from, to };

  const end = new Date();
  const start = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  return { from: isoDate(start), to: isoDate(end) };
}

async function readRows(code: string, from: string, to: string) {
  const res = await tursoClient.execute({
    sql: `
      SELECT code, date, open, high, low, close, volume
      FROM prices_daily
      WHERE code = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `,
    args: [code, from, to],
  });

  return (res.rows as any[]).map((r) => ({
    code: String(r.code),
    date: String(r.date),
    open: r.open == null ? null : Number(r.open),
    high: r.high == null ? null : Number(r.high),
    low: r.low == null ? null : Number(r.low),
    close: r.close == null ? null : Number(r.close),
    volume: r.volume == null ? null : Number(r.volume),
  }));
}

async function readMinMax(code: string, from: string, to: string) {
  const res = await tursoClient.execute({
    sql: `
      SELECT MIN(date) AS minDate, MAX(date) AS maxDate, COUNT(*) AS c
      FROM prices_daily
      WHERE code = ? AND date >= ? AND date <= ?
    `,
    args: [code, from, to],
  });

  const row = (res.rows as any[])[0] ?? {};
  return {
    count: Number(row.c ?? 0),
    minDate: row.minDate ? String(row.minDate) : null,
    maxDate: row.maxDate ? String(row.maxDate) : null,
  };
}

export async function GET(req: Request) {
  const rid = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  try {
    const { searchParams } = new URL(req.url);

    const code = (searchParams.get("code") ?? "").trim();
    const sync = (searchParams.get("sync") ?? "0").trim() === "1";

    if (!code) {
      return NextResponse.json({ ok: false, rid, error: "missing code" }, { status: 400 });
    }

    const rawFrom = searchParams.get("from");
    const rawTo = searchParams.get("to");
    const { from, to } = clampRange(rawFrom?.trim() || null, rawTo?.trim() || null);

    // ① まずDB
    const meta1 = await readMinMax(code, from, to);

    // ② 足りないなら同期（端だけ埋める）
    const syncResults: any[] = [];
    if (sync) {
      const needAll = meta1.count === 0;

      const needLeft = !needAll && meta1.minDate != null && meta1.minDate > from;
      const needRight = !needAll && meta1.maxDate != null && meta1.maxDate < to;

      // 全部足りない
      if (needAll) {
        const r = await syncDailyQuotesToDB({ code, from, to });
        syncResults.push({ segment: { from, to }, ...r });
      } else {
        // 左が欠けてる（from → minDate の前日まで…が理想だが簡易に from→minDate でOK）
        if (needLeft && meta1.minDate) {
          const r = await syncDailyQuotesToDB({ code, from, to: meta1.minDate });
          syncResults.push({ segment: { from, to: meta1.minDate }, ...r });
        }

        // 右が欠けてる（maxDate → to）
        if (needRight && meta1.maxDate) {
          const r = await syncDailyQuotesToDB({ code, from: meta1.maxDate, to });
          syncResults.push({ segment: { from: meta1.maxDate, to }, ...r });
        }
      }
    }

    // ③ 最後にDBを返す（同期後なら増えてるはず）
    const rows = await readRows(code, from, to);
    const meta2 = await readMinMax(code, from, to);

    return NextResponse.json({
      ok: true,
      rid,
      code,
      range: { from, to, sync },
      before: meta1,
      after: meta2,
      syncResults, // ★ upserted を見れば「DBが変わった」が分かる
      rows,
    });
  } catch (e: any) {
    console.error(`[prices:${rid}] ERROR`, e?.message ?? e);
    return NextResponse.json({ ok: false, rid, error: e?.message ?? "error" }, { status: 500 });
  }
}

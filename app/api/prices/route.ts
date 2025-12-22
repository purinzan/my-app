// app/api/prices/route.ts
import { NextResponse } from "next/server";
import { tursoClient } from "@/lib/db";
import { syncDailyQuotesToDB } from "@/lib/jquants";

/** ====== small utils ====== */
function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

const EDGE_TOLERANCE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtcDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

// a - b（日数）
function diffDays(aIso: string, bIso: string) {
  return Math.floor((toUtcDay(aIso) - toUtcDay(bIso)) / MS_PER_DAY);
}

// UTCで日付加算（ログや境界計算用）
function addDaysUtc(iso: string, days: number) {
  const t = toUtcDay(iso) + days * MS_PER_DAY;
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


function clampRange(from?: string | null, to?: string | null) {
  if (from && to) return { from, to };
  const end = new Date();
  const start = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  return { from: isoDate(start), to: isoDate(end) };
}

function log(rid: string, msg: string, obj?: any) {
  const t = new Date().toISOString();
  if (obj === undefined) console.log(`[prices:${rid}] ${t} ${msg}`);
  else console.log(`[prices:${rid}] ${t} ${msg}`, obj);
}

/** ====== DB profiler（速度切り分け） ====== */
type Prof = { dbCalls: number; dbTotalMs: number };

async function dbExec<T>(
  rid: string,
  prof: Prof,
  label: string,
  fn: () => Promise<T>,
  debug: boolean
): Promise<T> {
  const t0 = performance.now();
  prof.dbCalls += 1;
  try {
    const out = await fn();
    const ms = performance.now() - t0;
    prof.dbTotalMs += ms;
    if (debug) log(rid, `db:${label} ok`, { ms: Number(ms.toFixed(2)) });
    return out;
  } catch (e: any) {
    const ms = performance.now() - t0;
    prof.dbTotalMs += ms;
    log(rid, `db:${label} ERROR`, { ms: Number(ms.toFixed(2)), message: e?.message ?? e });
    throw e;
  }
}

/** ====== DB helpers ====== */
async function existsDate(
  rid: string,
  prof: Prof,
  debug: boolean,
  code: string,
  date: string
) {
  const res = await dbExec(
    rid,
    prof,
    "existsDate",
    () =>
      tursoClient.execute({
        sql: `SELECT 1 AS ok FROM prices_daily WHERE code = ? AND date = ? LIMIT 1`,
        args: [code, date],
      }),
    debug
  );
  return (res.rows as any[]).length > 0;
}

async function readRows(
  rid: string,
  prof: Prof,
  debug: boolean,
  code: string,
  from: string,
  to: string
) {
  const res = await dbExec(
    rid,
    prof,
    "readRows",
    () =>
      tursoClient.execute({
        sql: `
          SELECT code, date, open, high, low, close, volume
          FROM prices_daily
          WHERE code = ? AND date >= ? AND date <= ?
          ORDER BY date ASC
        `,
        args: [code, from, to],
      }),
    debug
  );

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

async function readMinMax(
  rid: string,
  prof: Prof,
  debug: boolean,
  code: string,
  from: string,
  to: string
) {
  const res = await dbExec(
    rid,
    prof,
    "readMinMax",
    () =>
      tursoClient.execute({
        sql: `
          SELECT MIN(date) AS minDate, MAX(date) AS maxDate, COUNT(*) AS c
          FROM prices_daily
          WHERE code = ? AND date >= ? AND date <= ?
        `,
        args: [code, from, to],
      }),
    debug
  );

  const row = (res.rows as any[])[0] ?? {};
  return {
    count: Number(row.c ?? 0),
    minDate: row.minDate ? String(row.minDate) : null,
    maxDate: row.maxDate ? String(row.maxDate) : null,
  };
}

async function firstAvailableDateInRange(
  rid: string,
  prof: Prof,
  debug: boolean,
  code: string,
  from: string,
  to: string
) {
  const res = await dbExec(
    rid,
    prof,
    "firstAvailableDateInRange",
    () =>
      tursoClient.execute({
        sql: `
          SELECT date
          FROM prices_daily
          WHERE code = ? AND date >= ? AND date <= ?
          ORDER BY date ASC
          LIMIT 1
        `,
        args: [code, from, to],
      }),
    debug
  );

  const row = (res.rows as any[])[0];
  return row?.date ? String(row.date) : null;
}

/** debug=1 の時だけ “DBが本当に入ってるか/範囲がどうか” を深掘りしてログ */
async function diagnoseCoverage(
  rid: string,
  prof: Prof,
  debug: boolean,
  code: string,
  from: string,
  to: string
) {
  if (!debug) return;

  const all = await dbExec(
    rid,
    prof,
    "coverage:all",
    () =>
      tursoClient.execute({
        sql: `
          SELECT COUNT(*) AS c, MIN(date) AS minDate, MAX(date) AS maxDate
          FROM prices_daily
          WHERE code = ?
        `,
        args: [code],
      }),
    true
  );

  const range = await dbExec(
    rid,
    prof,
    "coverage:range",
    () =>
      tursoClient.execute({
        sql: `
          SELECT COUNT(*) AS c, MIN(date) AS minDate, MAX(date) AS maxDate
          FROM prices_daily
          WHERE code = ? AND date >= ? AND date <= ?
        `,
        args: [code, from, to],
      }),
    true
  );

  const nearFrom = await dbExec(
    rid,
    prof,
    "coverage:nearFrom",
    () =>
      tursoClient.execute({
        sql: `
          SELECT date FROM prices_daily
          WHERE code = ? AND date >= ?
          ORDER BY date ASC
          LIMIT 3
        `,
        args: [code, from],
      }),
    true
  );

  const beforeFrom = await dbExec(
    rid,
    prof,
    "coverage:beforeFrom",
    () =>
      tursoClient.execute({
        sql: `
          SELECT date FROM prices_daily
          WHERE code = ? AND date <= ?
          ORDER BY date DESC
          LIMIT 3
        `,
        args: [code, from],
      }),
    true
  );

  const nearTo = await dbExec(
    rid,
    prof,
    "coverage:nearTo",
    () =>
      tursoClient.execute({
        sql: `
          SELECT date FROM prices_daily
          WHERE code = ? AND date <= ?
          ORDER BY date DESC
          LIMIT 3
        `,
        args: [code, to],
      }),
    true
  );

  const a = (all.rows as any[])[0] ?? {};
  const r = (range.rows as any[])[0] ?? {};

  log(rid, "coverage:db", {
    code,
    all: { count: Number(a.c ?? 0), minDate: a.minDate ?? null, maxDate: a.maxDate ?? null },
    range: { from, to, count: Number(r.c ?? 0), minDate: r.minDate ?? null, maxDate: r.maxDate ?? null },
    around: {
      nextFrom: (nearFrom.rows as any[]).map((x) => String(x.date)),
      prevFrom: (beforeFrom.rows as any[]).map((x) => String(x.date)),
      prevTo: (nearTo.rows as any[]).map((x) => String(x.date)),
    },
  });
}

/** ====== Route ====== */
export async function GET(req: Request) {
  // ★ rid は必ず GET 内で定義（ここが今回の致命傷を防ぐ）
  const rid = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  const t0 = performance.now();
  const prof: Prof = { dbCalls: 0, dbTotalMs: 0 };

  try {
    const { searchParams } = new URL(req.url);

    const rawCode = searchParams.get("code");
    const code = (rawCode ?? "").trim();

    const rawFrom = searchParams.get("from");
    const rawTo = searchParams.get("to");
    const { from, to } = clampRange(rawFrom?.trim() || null, rawTo?.trim() || null);

    const syncParam = searchParams.get("sync"); // null ならデフォルト true
    const sync = syncParam === null ? true : syncParam.trim() === "1";

    const debug = (searchParams.get("debug") ?? "0").trim() === "1";
    const syncMode = (searchParams.get("syncMode") ?? "auto").trim(); // auto | force | off

    log(rid, "request", {
      url: req.url,
      rawCode,
      code,
      codeLen: code.length,
      rawFrom,
      rawTo,
      from,
      to,
      sync,
      syncParam,
      syncMode,
      debug,
    });

    if (!code) {
      log(rid, "missing code -> 400");
      return NextResponse.json({ ok: false, rid, error: "missing code" }, { status: 400 });
    }

    // debug=1 の時だけ、DB実態を先に深掘り
    await diagnoseCoverage(rid, prof, debug, code, from, to);

    // ① DBメタ（同期前）
    log(rid, "readMinMax(before) start");
    const meta1 = await readMinMax(rid, prof, debug, code, from, to);
    log(rid, "readMinMax(before) done", meta1);

    const effectiveFrom = await firstAvailableDateInRange(rid, prof, debug, code, from, to);

    // ② 同期判定
    const syncResults: any[] = [];

    // syncMode の優先度：off > force > auto（sync=0も尊重）
    const finalSyncOn = sync && syncMode !== "off";

    if (finalSyncOn) {
      const needAll = meta1.count === 0;

      // 端のズレ（日数）
      const leftGapDays =
        !needAll && meta1.minDate != null ? diffDays(meta1.minDate, from) : null; // minDate - from
      const rightGapDays =
        !needAll && meta1.maxDate != null ? diffDays(to, meta1.maxDate) : null;   // to - maxDate

      // “7日超”だけ同期対象
      const needLeft =
        !needAll && leftGapDays != null && leftGapDays > EDGE_TOLERANCE_DAYS;
      const needRight =
        !needAll && rightGapDays != null && rightGapDays > EDGE_TOLERANCE_DAYS;

      const reasons: string[] = [];
      if (syncParam === null) reasons.push("sync-default-true");
      if (syncMode === "force") reasons.push("syncMode=force");

      if (syncMode === "force") {
        reasons.push("forced");
      } else {
        if (needAll) reasons.push("needAll(count=0)");
        if (needLeft) reasons.push(`needLeft(gap=${leftGapDays}d>7d)`);
        if (needRight) reasons.push(`needRight(gap=${rightGapDays}d>7d)`);
        if (reasons.length === 0) reasons.push("within-tolerance(<=7d)");
      }

      log(rid, "sync:decision", {
        finalSyncOn,
        sync,
        syncMode,
        meta1,
        effectiveFrom,
        needAll,
        leftGapDays,
        rightGapDays,
        needLeft,
        needRight,
        reasons,
      });

      // 実際に同期するか（= needAll or 端が7日超で欠ける or force）
      const shouldSync = syncMode === "force" || needAll || needLeft || needRight;

      if (shouldSync) {
        // ① empty-db → 全範囲
        if (meta1.count === 0) {
          log(rid, "sync: empty-db start", { segment: { from, to } });
          const r = await syncDailyQuotesToDB({ code, from, to });
          log(rid, "sync: empty-db done", r);
          syncResults.push({ reason: "empty-db", segment: { from, to }, ...r });
        } else {
          // 左端が7日超で欠けてる → [from, minDate-1] を埋める
          if (meta1.minDate && needLeft) {
            const leftTo = addDaysUtc(meta1.minDate, -1);
            log(rid, "sync: missing-left-edge start", { segment: { from, to: leftTo } });
            const r = await syncDailyQuotesToDB({ code, from, to: leftTo });
            log(rid, "sync: missing-left-edge done", r);
            syncResults.push({ reason: "missing-left-edge", segment: { from, to: leftTo }, ...r });
          }

          // 右端が7日超で欠けてる → [maxDate+1, to] を埋める
          if (meta1.maxDate && needRight) {
            const rightFrom = addDaysUtc(meta1.maxDate, 1);
            log(rid, "sync: missing-right-edge start", { segment: { from: rightFrom, to } });
            const r = await syncDailyQuotesToDB({ code, from: rightFrom, to });
            log(rid, "sync: missing-right-edge done", r);
            syncResults.push({ reason: "missing-right-edge", segment: { from: rightFrom, to }, ...r });
          }
        }
      } else {
        log(rid, "sync skipped (shouldSync=false)");
      }
    } else {
      log(rid, "sync mode OFF", { sync, syncMode });
    }


    // ③ DB（同期後）
    log(rid, "readRows(after) start");
    const rows = await readRows(rid, prof, debug, code, from, to);
    log(rid, "readRows(after) done", {
      rows: rows.length,
      first: rows[0]?.date ?? null,
      last: rows.at(-1)?.date ?? null,
    });

    log(rid, "readMinMax(after) start");
    const meta2 = await readMinMax(rid, prof, debug, code, from, to);
    log(rid, "readMinMax(after) done", meta2);

    const totalMs = performance.now() - t0;
    log(rid, "done", {
      totalMs: Number(totalMs.toFixed(2)),
      dbCalls: prof.dbCalls,
      dbTotalMs: Number(prof.dbTotalMs.toFixed(2)),
      rows: rows.length,
      syncResultsCount: syncResults.length,
    });

    return NextResponse.json({
      ok: true,
      rid,
      code,
      range: { from, to, sync: sync && syncMode !== "off", syncMode },
      effectiveFrom,
      before: meta1,
      after: meta2,
      syncResults,
      rows,
      perf: {
        totalMs: Number(totalMs.toFixed(2)),
        dbCalls: prof.dbCalls,
        dbTotalMs: Number(prof.dbTotalMs.toFixed(2)),
      },
    });
  } catch (e: any) {
    console.error(`[prices:${rid}] ERROR`, e?.stack ?? e?.message ?? e);
    return NextResponse.json({ ok: false, rid, error: e?.message ?? "error" }, { status: 500 });
  }
}

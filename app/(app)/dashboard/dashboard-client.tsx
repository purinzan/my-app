"use client";

import { useMemo, useState } from "react";

type Row = {
  date: string; // "YYYY-MM-DD"
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

export default function CandlesMin() {
  const [code, setCode] = useState("7203");
  const [from, setFrom] = useState("2025-10-15");
  const [to, setTo] = useState("2025-12-14");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ★ DBに無いときに自動でJ-Quantsを叩くスイッチ
  const [autoSync, setAutoSync] = useState(true);

  // ★ 何が起きてるか表示
  const [status, setStatus] = useState("");

  async function fetchPricesFromDB(codeClean: string, f: string, t: string) {
    const qs = new URLSearchParams({ code: codeClean });
    if (f) qs.set("from", f);
    if (t) qs.set("to", t);

    const res = await fetch(`/api/prices?${qs.toString()}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error ?? "failed to load prices");
    return (json.rows ?? []) as Row[];
  }

  async function syncFromJQuantsToDB(codeClean: string, f: string, t: string) {
    // from/to が空（ALL）なら、無限に取らないため直近180日を同期
    const syncQs = new URLSearchParams({ code: codeClean });

    if (f && t) {
      syncQs.set("from", f);
      syncQs.set("to", t);
    } else {
      const end = new Date();
      const start = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
      syncQs.set("from", isoDate(start));
      syncQs.set("to", isoDate(end));
    }

    const res = await fetch(`/api/jquants/daily?${syncQs.toString()}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error ?? "failed to sync from J-Quants");
    return json as { fetched?: number; saved?: number };
  }

  // ★ 「表示」ボタン：DB→なければJ-Quants→DB再読込→ローソクに反映
  async function load() {
    setLoading(true);
    setErr(null);
    setStatus("");

    const codeClean = code.trim();

    try {
      setStatus("DBから読み込み中…");
      const rows1 = await fetchPricesFromDB(codeClean, from, to);

      if (rows1.length > 0) {
        setRows(rows1);
        setStatus(`DBに ${rows1.length} 件あり（表示完了）`);
        return;
      }

      if (!autoSync) {
        setRows([]);
        setStatus("DBにデータがありません（自動同期OFF）");
        return;
      }

      setStatus("DBが空 → J-Quantsから取得して保存中…");
      const r = await syncFromJQuantsToDB(codeClean, from, to);
      setStatus(`同期完了 fetched=${r.fetched ?? "?"}, saved=${r.saved ?? "?"} → DB再読込…`);

      const rows2 = await fetchPricesFromDB(codeClean, from, to);
      setRows(rows2);
      setStatus(`表示完了：${rows2.length} 件`);
    } catch (e: any) {
      setErr(e?.message ?? "error");
      setRows([]);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  // ローソク足として描画できるデータだけ
  const candles = useMemo(() => {
    return rows.filter((r) => r.open != null && r.high != null && r.low != null && r.close != null);
  }, [rows]);

  // SVG座標計算（最小）
  const chart = useMemo(() => {
    const W = 980;
    const H = 360;
    const padL = 40;
    const padR = 10;
    const padT = 10;
    const padB = 20;

    if (candles.length === 0) {
      return { W, H, padL, padR, padT, padB, points: [] as any[] };
    }

    const lows = candles.map((d) => d.low as number);
    const highs = candles.map((d) => d.high as number);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const range = Math.max(1e-9, max - min);

    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    // x は indexベース（最小）
    const step = candles.length > 1 ? innerW / (candles.length - 1) : innerW;
    const x = (i: number) => padL + i * step;

    const y = (v: number) => padT + (max - v) * (innerH / range);

    const bodyW = Math.max(4, Math.floor(innerW / Math.max(30, candles.length)));

    const points = candles.map((d, i) => ({
      x: x(i),
      date: d.date,
      open: d.open as number,
      high: d.high as number,
      low: d.low as number,
      close: d.close as number,
      yOpen: y(d.open as number),
      yClose: y(d.close as number),
      yHigh: y(d.high as number),
      yLow: y(d.low as number),
      bodyW,
      up: (d.close as number) >= (d.open as number),
    }));

    return { W, H, padL, padR, padT, padB, points };
  }, [candles]);

  return (
    <div className="space-y-4">
      {/* 入力 + 期間バー */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600 dark:text-slate-300">銘柄コード</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600 dark:text-slate-300">from</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600 dark:text-slate-300">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            />
          </label>

          <button
            onClick={load}
            disabled={loading}
            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-slate-900"
          >
            {loading ? "読み込み中…" : "表示"}
          </button>

          <label className="ml-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />
            DBに無ければJ-Quantsで取得して保存
          </label>

          <div className="text-sm text-slate-600 dark:text-slate-300">
            rows: {rows.length} / candles: {candles.length}
          </div>
        </div>

        {/* 期間選択バー（プリセット） */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            onClick={() => {
              const end = new Date();
              setTo(isoDate(end));
              setFrom(isoDate(addMonths(end, -1)));
            }}
          >
            1M
          </button>

          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            onClick={() => {
              const end = new Date();
              setTo(isoDate(end));
              setFrom(isoDate(addMonths(end, -3)));
            }}
          >
            3M
          </button>

          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            onClick={() => {
              const end = new Date();
              setTo(isoDate(end));
              setFrom(isoDate(addMonths(end, -6)));
            }}
          >
            6M
          </button>

          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            onClick={() => {
              const end = new Date();
              setTo(isoDate(end));
              setFrom(isoDate(startOfYear(end)));
            }}
          >
            YTD
          </button>

          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            onClick={() => {
              const end = new Date();
              setTo(isoDate(end));
              setFrom(isoDate(addMonths(end, -12)));
            }}
          >
            1Y
          </button>

          <button
            type="button"
            className="rounded-full border border-slate-200 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
          >
            ALL
          </button>

          <button
            type="button"
            className="rounded-full bg-slate-900 px-3 py-1 text-sm text-white hover:opacity-90 dark:bg-white dark:text-slate-900"
            onClick={load}
          >
            適用
          </button>
        </div>

        {status && <div className="text-xs text-slate-600 dark:text-slate-300">{status}</div>}
        {err && <div className="text-sm text-red-600 dark:text-red-400">{err}</div>}
      </div>

      {/* ローソク足 */}
      <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
        <div className="text-sm font-semibold">ローソク足（API問い合わせ→反映）</div>

        <div className="mt-2 overflow-x-auto">
          <svg width={chart.W} height={chart.H} className="block">
            <rect
              x={chart.padL}
              y={chart.padT}
              width={chart.W - chart.padL - chart.padR}
              height={chart.H - chart.padT - chart.padB}
              fill="none"
              stroke="currentColor"
              opacity={0.15}
            />

            {chart.points.map((p, i) => {
              const top = Math.min(p.yOpen, p.yClose);
              const bottom = Math.max(p.yOpen, p.yClose);
              const h = Math.max(1, bottom - top);

              // 見やすさのため最小限の色（上=緑、下=赤）
              const stroke = p.up ? "#10b981" : "#f43f5e";
              const fill = stroke;

              return (
                <g key={i}>
                  <line x1={p.x} x2={p.x} y1={p.yHigh} y2={p.yLow} stroke={stroke} strokeWidth={1} />
                  <rect x={p.x - p.bodyW / 2} y={top} width={p.bodyW} height={h} fill={fill} rx={1} />
                </g>
              );
            })}
          </svg>
        </div>

        {candles.length === 0 && !loading && (
          <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            データがありません。自動同期ONなら「表示」を押すと取得して反映されます。
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Row = {
  code: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

function sma(values: (number | null)[], period: number) {
  const out: (number | null)[] = [];
  let sum = 0;
  let cnt = 0;
  const queue: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      out.push(null);
      continue;
    }
    queue.push(v);
    sum += v;
    cnt++;

    if (queue.length > period) {
      sum -= queue.shift()!;
      cnt--;
    }
    out.push(queue.length === period ? sum / period : null);
  }
  return out;
}

export default function DashboardClient() {
  const [code, setCode] = useState("7203");
  const [from, setFrom] = useState(""); // 任意
  const [to, setTo] = useState("");     // 任意
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
  setLoading(true);
  setErr(null);

  const qs = new URLSearchParams({ code });
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  // 1) まずDBから読む
  try {
    const res1 = await fetch(`/api/prices?${qs.toString()}`, { cache: "no-store" });
    const json1 = await res1.json();
    if (!res1.ok || !json1.ok) throw new Error(json1.error ?? "failed to load prices");

    const rows1 = (json1.rows ?? []) as Row[];
    if (rows1.length > 0) {
      setRows(rows1);
      return;
    }

    // 2) 0件ならJ-Quantsで同期（保存までやるAPI）
    //    from/to があれば範囲、なければ date を指定（任意）
    const syncQs = new URLSearchParams({ code });
    if (from) syncQs.set("from", from);
    if (to) syncQs.set("to", to);

    // from/toが無い場合は、例として date を入れたいならここで指定（任意）
    // syncQs.set("date", "2025-12-11");

    const res2 = await fetch(`/api/jquants/daily?${syncQs.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const json2 = await res2.json();
    if (!res2.ok || !json2.ok) throw new Error(json2.error ?? "failed to sync from J-Quants");

    // 3) もう一度DBから読む（同期後）
    const res3 = await fetch(`/api/prices?${qs.toString()}`, { cache: "no-store" });
    const json3 = await res3.json();
    if (!res3.ok || !json3.ok) throw new Error(json3.error ?? "failed to reload prices");

    setRows((json3.rows ?? []) as Row[]);
  } catch (e: any) {
    setErr(e?.message ?? "error");
    setRows([]);
  } finally {
    setLoading(false);
  }
}


  const computed = useMemo(() => {
    const closes = rows.map((r) => r.close);
    const sma5 = sma(closes, 5);
    const sma20 = sma(closes, 20);

    const chart = rows.map((r, i) => {
      const range =
        r.high != null && r.low != null ? r.high - r.low : null;

      return {
        date: r.date.slice(5), // "MM-DD"
        close: r.close ?? null,
        volume: r.volume ?? null,
        sma5: sma5[i],
        sma20: sma20[i],
        range,
      };
    });

    const avgVolume =
      rows.length === 0
        ? null
        : Math.round(
            rows.reduce((acc, r) => acc + (r.volume ?? 0), 0) / rows.length
          );

    const avgRange =
      rows.length === 0
        ? null
        : (() => {
            const vals = rows
              .map((r) => (r.high != null && r.low != null ? r.high - r.low : null))
              .filter((v): v is number => v != null);
            if (vals.length === 0) return null;
            return vals.reduce((a, b) => a + b, 0) / vals.length;
          })();

    return { chart, avgVolume, avgRange };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">銘柄データ</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Tursoの prices_daily から読み出して、表→グラフ→軽い分析を表示します。
        </p>
      </div>

      {/* 入力 */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-300">銘柄コード</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="7203"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-300">from（任意）</span>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="2025-12-01"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-600 dark:text-slate-300">to（任意）</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="2025-12-12"
          />
        </label>

        <button
          onClick={load}
          className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-slate-900"
          disabled={loading}
        >
          {loading ? "読み込み中…" : "読み込む"}
        </button>

        {err && (
          <span className="text-sm text-red-600 dark:text-red-400">{err}</span>
        )}
      </div>

      {/* 分析（軽い集計） */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="text-xs text-slate-600 dark:text-slate-300">件数</div>
          <div className="mt-1 text-xl font-bold">{rows.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="text-xs text-slate-600 dark:text-slate-300">平均出来高</div>
          <div className="mt-1 text-xl font-bold">
            {computed.avgVolume == null ? "-" : computed.avgVolume.toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="text-xs text-slate-600 dark:text-slate-300">平均値幅（High-Low）</div>
          <div className="mt-1 text-xl font-bold">
            {computed.avgRange == null ? "-" : computed.avgRange.toFixed(2)}
          </div>
        </div>
      </div>

      {/* グラフ */}
      <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
        <div className="text-sm font-semibold">終値（折れ線）＋出来高（棒）＋移動平均</div>
        <div className="mt-3 h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={computed.chart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip />
              <Bar yAxisId="right" dataKey="volume" />
              <Line yAxisId="left" type="monotone" dataKey="close" dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="sma5" dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="sma20" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 表 */}
      <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
        <div className="text-sm font-semibold">日足（prices_daily）</div>
        <div className="mt-3 overflow-auto">
          <table className="min-w-[900px] text-left text-sm">
            <thead className="text-xs text-slate-600 dark:text-slate-300">
              <tr>
                <th className="py-2 pr-4">date</th>
                <th className="py-2 pr-4">open</th>
                <th className="py-2 pr-4">high</th>
                <th className="py-2 pr-4">low</th>
                <th className="py-2 pr-4">close</th>
                <th className="py-2 pr-4">volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="py-2 pr-4">{r.date}</td>
                  <td className="py-2 pr-4">{r.open ?? "-"}</td>
                  <td className="py-2 pr-4">{r.high ?? "-"}</td>
                  <td className="py-2 pr-4">{r.low ?? "-"}</td>
                  <td className="py-2 pr-4 font-semibold">{r.close ?? "-"}</td>
                  <td className="py-2 pr-4">{r.volume?.toLocaleString() ?? "-"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="py-4 text-slate-600 dark:text-slate-300" colSpan={6}>
                    まだデータがありません。先に /api/jquants/daily で保存してから読み込んでください。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

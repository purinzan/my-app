"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
  Customized,
} from "recharts";

// =====================
// 型
// =====================
type CandleDatum = {
  date: string; // XAxis(dataKey="date") と一致させる（ISO文字列推奨）
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type ListedInfoRow = {
  Code: string; // 例: "72030"
  CompanyName: string;
};

// =====================
// Customized Candles（落ちない・描けない時は描かない）
// =====================
function Candles(props: any) {
  const { xAxisMap, yAxisMap, offset, data, clipPathId } = props ?? {};

  const xAxis = Object.values(xAxisMap ?? {})[0] as any;
  const yAxis = Object.values(yAxisMap ?? {})[0] as any;
  const xScale = xAxis?.scale;
  const yScale = yAxis?.scale;

  if (!xScale || !yScale) return null;
  if (!offset || typeof offset.left !== "number" || typeof offset.top !== "number") return null;
  if (!Array.isArray(data) || data.length === 0) return null;

  const band = typeof xScale.bandwidth === "function" ? xScale.bandwidth() : 10;
  const bodyW = Math.max(3, Math.floor(band * 0.6));
  const cxOffset = band ? band / 2 : 0;

  const clip = clipPathId ? `url(#${clipPathId})` : undefined;

  return (
    <g clipPath={clip}>
      {(data as CandleDatum[]).map((d, i) => {
        if (d?.open == null || d?.close == null || d?.high == null || d?.low == null) return null;

        const x0 = xScale(d.date);
        if (x0 == null || !Number.isFinite(x0)) return null;

        const yHigh0 = yScale(d.high);
        const yLow0 = yScale(d.low);
        const yOpen0 = yScale(d.open);
        const yClose0 = yScale(d.close);

        if (
          !Number.isFinite(yHigh0) ||
          !Number.isFinite(yLow0) ||
          !Number.isFinite(yOpen0) ||
          !Number.isFinite(yClose0)
        ) {
          return null;
        }

        const x = x0 + offset.left + cxOffset;
        const yHigh = yHigh0 + offset.top;
        const yLow = yLow0 + offset.top;
        const yOpen = yOpen0 + offset.top;
        const yClose = yClose0 + offset.top;

        const up = d.close >= d.open;
        const top = Math.min(yOpen, yClose);
        const bottom = Math.max(yOpen, yClose);
        const h = Math.max(1, bottom - top);

        // Tailwind purge が心配なら tailwind.config の safelist を使うか style 直指定にして下さい
        const cls = up ? "stroke-emerald-500 fill-emerald-500" : "stroke-rose-500 fill-rose-500";

        return (
          <g key={d.date ?? i} className={cls}>
            <line x1={x} x2={x} y1={yHigh} y2={yLow} strokeWidth={1} />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={h} rx={1} />
          </g>
        );
      })}
    </g>
  );
}

// =====================
// Tooltip（シンプル）
// =====================
function CandleTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload?.[0]?.payload as CandleDatum | undefined;
  if (!d) return null;

  return (
    <div className="rounded-lg border bg-white/90 p-3 text-xs shadow-sm">
      <div className="font-semibold">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
        <div>O</div>
        <div className="text-right tabular-nums">{d.open}</div>
        <div>H</div>
        <div className="text-right tabular-nums">{d.high}</div>
        <div>L</div>
        <div className="text-right tabular-nums">{d.low}</div>
        <div>C</div>
        <div className="text-right tabular-nums">{d.close}</div>
      </div>
    </div>
  );
}

// =====================
// DashboardClient（全体）
// =====================
//
// 依存:
//   npm i recharts
//
// 想定API（ここはあなたの実装に合わせてURLだけ変えてOK）:
//   1) 銘柄一覧（会社名表示用）: GET /api/listed-info  -> ListedInfoRow[]
//   2) 日足OHLC:                GET /api/ohlc?code=72030 -> CandleDatum[]
//
// 返却の date は ISO(YYYY-MM-DD) 推奨（XAxis domain と一致させるため）
// =====================
export default function DashboardClient() {
  const [code, setCode] = useState<string>("72030");
  const [listed, setListed] = useState<ListedInfoRow[]>([]);
  const [data, setData] = useState<CandleDatum[]>([]);
  const [loadingListed, setLoadingListed] = useState<boolean>(false);
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Brushで選択した範囲（テーブルにも反映）
  const [range, setRange] = useState<{ startIndex?: number; endIndex?: number }>({});

  // 会社名
  const companyName = useMemo(() => {
    const hit = listed.find((r) => String(r.Code) === String(code));
    return hit?.CompanyName ?? "";
  }, [listed, code]);

  // 初回: 銘柄一覧を取得（会社名表示用）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoadingListed(true);
        setError("");

        const res = await fetch("/api/listed-info", { cache: "no-store" });
        if (!res.ok) throw new Error(`listed-info fetch failed: ${res.status}`);

        const json = (await res.json()) as ListedInfoRow[];
        if (cancelled) return;

        setListed(Array.isArray(json) ? json : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "listed-info error");
      } finally {
        if (!cancelled) setLoadingListed(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // code 変更: OHLC取得
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoadingData(true);
        setError("");

        const res = await fetch(`/api/ohlc?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`ohlc fetch failed: ${res.status}`);

        const json = (await res.json()) as CandleDatum[];
        if (cancelled) return;

        const cleaned =
          Array.isArray(json) && json.length
            ? json
                .map((d) => ({
                  date: String(d.date),
                  open: Number(d.open),
                  high: Number(d.high),
                  low: Number(d.low),
                  close: Number(d.close),
                  volume: d.volume == null ? undefined : Number(d.volume),
                }))
                .filter(
                  (d) =>
                    d.date &&
                    Number.isFinite(d.open) &&
                    Number.isFinite(d.high) &&
                    Number.isFinite(d.low) &&
                    Number.isFinite(d.close)
                )
            : [];

        setData(cleaned);
        setRange({}); // 範囲はリセット
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "ohlc error");
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  // Y軸 domain（余白ちょい足し）
  const yDomain = useMemo(() => {
    if (!data.length) return ["auto", "auto"] as const;
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of data) {
      lo = Math.min(lo, d.low);
      hi = Math.max(hi, d.high);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return ["auto", "auto"] as const;
    const pad = (hi - lo) * 0.05 || 1;
    return [lo - pad, hi + pad] as const;
  }, [data]);

  // テーブルに出すデータ（Brush範囲があればその範囲）
  const tableData = useMemo(() => {
    if (!data.length) return [];
    const s = range.startIndex;
    const e = range.endIndex;
    if (typeof s === "number" && typeof e === "number" && s >= 0 && e >= s) {
      return data.slice(s, e + 1);
    }
    return data;
  }, [data, range]);

  const header = useMemo(() => {
    const name = companyName ? ` - ${companyName}` : "";
    return `${code}${name}`;
  }, [code, companyName]);

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px]">
          <div className="text-sm text-neutral-500">銘柄コード</div>
          <input
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            inputMode="numeric"
            placeholder="例: 72030"
          />
          <div className="mt-1 text-xs text-neutral-600">
            {loadingListed ? "会社名取得中…" : companyName ? companyName : "会社名なし（未取得 or 未一致）"}
          </div>
        </div>

        <div className="flex-1">
          <div className="text-sm text-neutral-500">表示</div>
          <div className="mt-1 rounded-lg border bg-white px-3 py-2 text-sm">
            <span className="font-semibold">{header}</span>
            <span className="ml-2 text-xs text-neutral-500">
              {loadingData ? "データ取得中…" : data.length ? `${data.length}本` : "データなし"}
            </span>
          </div>
        </div>
      </div>

      {/* エラー */}
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">{error}</div> : null}

      {/* チャート */}
      <div className="rounded-xl border bg-white p-3">
        <div className="mb-2 text-sm font-semibold">ローソク足</div>

        <div className="h-[360px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                minTickGap={24}
                tick={{ fontSize: 12 }}
                // YYYY-MM-DD を想定
                tickFormatter={(v) => String(v).slice(5)}
              />
              <YAxis
                domain={yDomain as any}
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => (Number.isFinite(v) ? Number(v).toFixed(0) : v)}
              />
              <Tooltip content={<CandleTooltip />} />

              {/* ローソク足 */}
              <Customized component={Candles} />

              {/* スクロールバー（Brush） */}
              {data.length > 20 ? (
                <Brush
                  dataKey="date"
                  height={24}
                  travellerWidth={10}
                  onChange={(r: any) => {
                    // r: { startIndex, endIndex }
                    if (!r) return;
                    setRange({ startIndex: r.startIndex, endIndex: r.endIndex });
                  }}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 日足テーブル（スクロール） */}
      <div className="rounded-xl border bg-white p-3">
        <div className="mb-2 text-sm font-semibold">日足データ（スクロール）</div>

        <div className="max-h-[320px] overflow-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-right font-semibold">Open</th>
                <th className="px-3 py-2 text-right font-semibold">High</th>
                <th className="px-3 py-2 text-right font-semibold">Low</th>
                <th className="px-3 py-2 text-right font-semibold">Close</th>
              </tr>
            </thead>
            <tbody>
              {tableData.map((d) => (
                <tr key={d.date} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{d.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.open}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.high}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.low}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{d.close}</td>
                </tr>
              ))}
              {!loadingData && !tableData.length ? (
                <tr>
                  <td className="px-3 py-6 text-center text-neutral-500" colSpan={5}>
                    データがありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-2 text-xs text-neutral-500">
          Brush で範囲選択すると、この表も同じ範囲だけ表示されます
        </div>
      </div>
    </div>
  );
}

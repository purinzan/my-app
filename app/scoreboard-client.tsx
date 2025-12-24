"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";

type Item = {
  rank: number;
  code: string;
  company: Record<string, string> | null;
  score: number;
  open_volatility_ratio: number;
  gap_ratio: number;
  volatility_spike_ratio: number;
  intraday_momentum: number;
  volume_surge_today: number;
};

type MetricKey =
  | "score"
  | "open_volatility_ratio"
  | "gap_ratio"
  | "volatility_spike_ratio"
  | "intraday_momentum"
  | "volume_surge_today";

type Api = {
  ok: boolean;
  range: { from: string; to: string };
  params: any;
  sync: { requestedDays: number; fetchedDays: number; skippedDays: number; quotes: number; upserted: number };
  universe: { barsInDb: number; codesWithBars: number; scoredCodes: number };
  company: { loaded: number; missingCompanyInTop: number };
  items: Item[];
  error?: string;
  debug?: any;
};

function fmt(n: number, d = 4) {
  return Number.isFinite(n) ? n.toFixed(d) : "";
}

function clampNumber(input: string, fallback: number, { min, max }: { min?: number; max?: number } = {}) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

export default function ScoreboardClient() {
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [limit, setLimit] = useState(100);
  const [marketCap, setMarketCap] = useState("");
  const [marketCapMode, setMarketCapMode] = useState<"over" | "under">("over");

  const [sync, setSync] = useState(true);
  const [force, setForce] = useState(false);
  const [debug, setDebug] = useState(false);

  const [w_openvol, setWOpenVol] = useState(0.25);
  const [w_gap, setWGap] = useState(0.1);
  const [w_spike, setWSpike] = useState(0.35);
  const [w_intraday, setWIntraday] = useState(0.1);
  const [w_volsurge, setWVolsurge] = useState(0.2);
  const [openWeights, setOpenWeights] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [api, setApi] = useState<Api | null>(null);

  async function run() {
    if (!from || !to) {
      setErr("日付を入力してください (YYYY-MM-DD)");
      return;
    }

    setLoading(true);
    setErr("");
    setApi(null);
    try {
      const qs = new URLSearchParams();
      qs.set("from", from);
      qs.set("to", to);
      qs.set("limit", String(limit));
      const marketCapNum = Number(marketCap);
      if (Number.isFinite(marketCapNum) && marketCapNum > 0) {
        qs.set("marketCap", String(marketCapNum * 1_000_000_000));
        qs.set("marketCapMode", marketCapMode);
      }
      qs.set("sync", sync ? "1" : "0");
      qs.set("force", force ? "1" : "0");
      qs.set("w_openvol", String(w_openvol));
      qs.set("w_gap", String(w_gap));
      qs.set("w_spike", String(w_spike));
      qs.set("w_intraday", String(w_intraday));
      qs.set("w_volsurge", String(w_volsurge));
      if (debug) qs.set("debug", "1");

      const res = await fetch(`/api/scoreboard?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as Api;

      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setApi(json);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => api?.items ?? [], [api]);

  const rankedTables = useMemo(
    () =>
      (
        [
          { key: "score", label: "Total Score", precision: 4, description: "weighted score" },
          {
            key: "open_volatility_ratio",
            label: "OpenVolatilityRatio",
            precision: 6,
            description: "range / open for today",
          },
          { key: "gap_ratio", label: "GapRatio", precision: 6, description: "gap vs prev close" },
          {
            key: "volatility_spike_ratio",
            label: "VolatilitySpikeRatio",
            precision: 6,
            description: "today vs recent volatility",
          },
          {
            key: "intraday_momentum",
            label: "IntradayMomentum",
            precision: 6,
            description: "close vs open",
          },
          {
            key: "volume_surge_today",
            label: "VolumeSurgeToday",
            precision: 6,
            description: "today volume vs avg",
          },
        ] satisfies { key: MetricKey; label: string; precision: number; description: string }[]
      ).map((metric) => ({
        ...metric,
        rows: [...rows]
          .sort((a, b) => (Number(b[metric.key]) || 0) - (Number(a[metric.key]) || 0))
          .map((item, index) => ({ ...item, rank: index + 1 })),
      })),
    [rows],
  );

  const csvRows = useMemo(() => {
    return [...rows]
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
      .map((item, index) => ({
        ...item,
        rank: Number.isFinite(item.rank) ? item.rank : index + 1,
      }));
  }, [rows]);

  const downloadCsv = () => {
    if (csvRows.length === 0) return;

    const headers: Array<keyof Item | "company_name"> = [
      "rank",
      "code",
      "company_name",
      "score",
      "open_volatility_ratio",
      "gap_ratio",
      "volatility_spike_ratio",
      "intraday_momentum",
      "volume_surge_today",
    ];

    const escapeCell = (value: unknown) => {
      if (value === null || value === undefined) return "";
      const str = String(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = [
      headers.join(","),
      ...csvRows.map((row) => {
        const companyName = row.company?.CompanyName ?? row.company?.CompanyNameEnglish ?? "";
        const values = [
          row.rank,
          row.code,
          companyName,
          row.score,
          row.open_volatility_ratio,
          row.gap_ratio,
          row.volatility_spike_ratio,
          row.intraday_momentum,
          row.volume_surge_today,
        ];
        return values.map(escapeCell).join(",");
      }),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `scoreboard_${to || "data"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex justify-end">
        <Link
          href="/dashboard"
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white no-underline hover:opacity-90 dark:bg-white dark:text-slate-900"
        >
          ダッシュボードへ
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">from</div>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          />
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">to</div>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          />
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">limit</div>
          <input
            type="number"
            min={10}
            max={500}
            value={limit}
            onChange={(e) => setLimit((prev) => clampNumber(e.target.value, prev, { min: 10, max: 500 }))}
            className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          />
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">時価総額(十億円)</div>
          <input
            type="number"
            min={0}
            value={marketCap}
            onChange={(e) => setMarketCap(e.target.value)}
            className="mt-1 w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            placeholder="例: 100"
          />
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMarketCapMode("over")}
            className={[
              "rounded-xl border px-3 py-2 text-xs font-semibold",
              marketCapMode === "over"
                ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                : "border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200",
            ].join(" ")}
          >
            以上
          </button>
          <button
            type="button"
            onClick={() => setMarketCapMode("under")}
            className={[
              "rounded-xl border px-3 py-2 text-xs font-semibold",
              marketCapMode === "under"
                ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                : "border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200",
            ].join(" ")}
          >
            以下
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
          同期する
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          force
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
          ログ出力
        </label>

        <button
          onClick={run}
          disabled={loading}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          type="button"
        >
          {loading ? "実行中..." : "ランキング更新"}
        </button>

        <button
          onClick={() => setOpenWeights(true)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          type="button"
        >
          設定
        </button>

        <button
          onClick={downloadCsv}
          disabled={loading || csvRows.length === 0}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
          type="button"
        >
          CSVで保存
        </button>
      </div>

      {openWeights ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Weight settings</div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                onClick={() => setOpenWeights(false)}
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
              <div className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
                <div className="text-slate-500">w_openvol</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  value={w_openvol}
                  onChange={(e) => setWOpenVol((prev) => clampNumber(e.target.value, prev))}
                />
              </div>
              <div className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
                <div className="text-slate-500">w_gap</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  value={w_gap}
                  onChange={(e) => setWGap((prev) => clampNumber(e.target.value, prev))}
                />
              </div>
              <div className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
                <div className="text-slate-500">w_spike</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  value={w_spike}
                  onChange={(e) => setWSpike((prev) => clampNumber(e.target.value, prev))}
                />
              </div>
              <div className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
                <div className="text-slate-500">w_intraday</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  value={w_intraday}
                  onChange={(e) => setWIntraday((prev) => clampNumber(e.target.value, prev))}
                />
              </div>
              <div className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
                <div className="text-slate-500">w_volsurge</div>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
                  value={w_volsurge}
                  onChange={(e) => setWVolsurge((prev) => clampNumber(e.target.value, prev))}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      ) : null}

      {api ? (
        <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">
          range: {api.range.from} → {api.range.to} / requestedDays: {api.sync.requestedDays} / fetchedDays:{" "}
          {api.sync.fetchedDays} / skippedDays: {api.sync.skippedDays} / upserted: {api.sync.upserted} / scoredCodes:{" "}
          {api.universe.scoredCodes} / company.loaded: {api.company.loaded} / missingCompanyInTop: {api.company.missingCompanyInTop}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {rankedTables.map(({ key, label, precision, description, rows: rankedRows }) => (
          <div key={key} className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-100">
              <span title={description}>{label}</span>
            </div>

            <div className="max-h-[360px] overflow-x-auto overflow-y-auto">
              <table className="min-w-[520px] w-full border-separate border-spacing-y-1">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900/80">
                  <tr className="text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <th className="px-2">Rank</th>
                    <th className="px-2">Code</th>
                    <th className="px-2">Company</th>
                    <th className="px-2 text-right">
                      <span title={description}>{key === "score" ? "Score" : label}</span>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rankedRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-sm text-slate-500">
                        まだランキングが出ていません
                      </td>
                    </tr>
                  ) : (
                    rankedRows.map((r) => (
                      <tr key={r.code} className="rounded-xl bg-slate-50 text-sm dark:bg-slate-900/40">
                        <td className="px-2 py-1">{r.rank}</td>
                        <td className="px-2 py-1 font-mono">{r.code}</td>
                        <td className="px-2 py-1">{r.company?.CompanyName ?? r.company?.CompanyNameEnglish ?? "-"}</td>
                        <td className="px-2 py-1 text-right font-semibold">{fmt(r[key as MetricKey], precision)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

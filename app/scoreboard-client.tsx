"use client";

import React, { useMemo, useState } from "react";

type Item = {
  rank: number;
  code: string;
  company: Record<string, string> | null;
  score: number;
  ret_mean: number;
  volchg_ratio: number;
  volat_rto_mean: number;
  mom_n_days: number;
};

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

export default function ScoreboardClient() {
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [monthsBack, setMonthsBack] = useState(3);
  const [limit, setLimit] = useState(100);

  const [sync, setSync] = useState(true);
  const [force, setForce] = useState(false);

  const [w_ret, setWRet] = useState(0.35);
  const [w_volchg, setWVolchg] = useState(0.25);
  const [w_volat, setWVolat] = useState(0.2);
  const [w_mom, setWMom] = useState(0.2);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [api, setApi] = useState<Api | null>(null);

  async function run() {
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      qs.set("to", to);
      qs.set("monthsBack", String(monthsBack));
      qs.set("limit", String(limit));
      qs.set("sync", sync ? "1" : "0");
      qs.set("force", force ? "1" : "0");
      qs.set("w_ret", String(w_ret));
      qs.set("w_volchg", String(w_volchg));
      qs.set("w_volat", String(w_volat));
      qs.set("w_mom", String(w_mom));
      qs.set("debug", "1"); // 迷ったら残す。不要なら消してOK

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

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-wrap items-end gap-3">
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
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">monthsBack</div>
          <input
            type="number"
            min={1}
            max={24}
            value={monthsBack}
            onChange={(e) => setMonthsBack(Number(e.target.value))}
            className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          />
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">limit</div>
          <input
            type="number"
            min={10}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
          同期する
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          force
        </label>

        <button
          onClick={run}
          disabled={loading}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          type="button"
        >
          {loading ? "実行中..." : "ランキング更新"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
          <div className="text-slate-500">w_ret</div>
          <input className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1" value={w_ret} onChange={(e) => setWRet(Number(e.target.value))} />
        </div>
        <div className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
          <div className="text-slate-500">w_volchg</div>
          <input className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1" value={w_volchg} onChange={(e) => setWVolchg(Number(e.target.value))} />
        </div>
        <div className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
          <div className="text-slate-500">w_volat</div>
          <input className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1" value={w_volat} onChange={(e) => setWVolat(Number(e.target.value))} />
        </div>
        <div className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
          <div className="text-slate-500">w_mom</div>
          <input className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1" value={w_mom} onChange={(e) => setWMom(Number(e.target.value))} />
        </div>
      </div>

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

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[980px] w-full border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
              <th className="px-2">Rank</th>
              <th className="px-2">Code</th>
              <th className="px-2">Company</th>
              <th className="px-2 text-right">Score</th>
              <th className="px-2 text-right">ret_mean</th>
              <th className="px-2 text-right">volchg_ratio</th>
              <th className="px-2 text-right">volat_rto_mean</th>
              <th className="px-2 text-right">mom_n_days</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-8 text-sm text-slate-500">
                  まだランキングが出ていません
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.code} className="rounded-xl bg-slate-50 text-sm dark:bg-slate-900/40">
                  <td className="px-2 py-2">{r.rank}</td>
                  <td className="px-2 py-2 font-mono">{r.code}</td>
                  <td className="px-2 py-2">{r.company?.CompanyName ?? r.company?.CompanyNameEnglish ?? "-"}</td>
                  <td className="px-2 py-2 text-right font-semibold">{fmt(r.score, 4)}</td>
                  <td className="px-2 py-2 text-right">{fmt(r.ret_mean, 6)}</td>
                  <td className="px-2 py-2 text-right">{fmt(r.volchg_ratio, 4)}</td>
                  <td className="px-2 py-2 text-right">{fmt(r.volat_rto_mean, 6)}</td>
                  <td className="px-2 py-2 text-right">{fmt(r.mom_n_days, 6)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

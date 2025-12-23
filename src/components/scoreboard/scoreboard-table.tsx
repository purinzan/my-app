import React from "react";
import type { Item } from "@/lib/scoreboard/types";

type ScoreboardTableProps = {
  rows: Item[];
  formatNumber: (value: number, digits?: number) => string;
};

export function ScoreboardTable({ rows, formatNumber }: ScoreboardTableProps) {
  return (
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
                <td className="px-2 py-2 text-right font-semibold">{formatNumber(r.score, 4)}</td>
                <td className="px-2 py-2 text-right">{formatNumber(r.ret_mean, 6)}</td>
                <td className="px-2 py-2 text-right">{formatNumber(r.volchg_ratio, 4)}</td>
                <td className="px-2 py-2 text-right">{formatNumber(r.volat_rto_mean, 6)}</td>
                <td className="px-2 py-2 text-right">{formatNumber(r.mom_n_days, 6)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

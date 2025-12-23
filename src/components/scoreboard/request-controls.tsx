import React from "react";

export type RequestControlsProps = {
  to: string;
  monthsBack: number;
  limit: number;
  sync: boolean;
  force: boolean;
  loading: boolean;
  onChangeTo: (value: string) => void;
  onChangeMonthsBack: (value: string) => void;
  onChangeLimit: (value: string) => void;
  onToggleSync: (checked: boolean) => void;
  onToggleForce: (checked: boolean) => void;
  onRun: () => void;
};

export function RequestControls({
  to,
  monthsBack,
  limit,
  sync,
  force,
  loading,
  onChangeTo,
  onChangeMonthsBack,
  onChangeLimit,
  onToggleSync,
  onToggleForce,
  onRun,
}: RequestControlsProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">to</div>
        <input
          type="date"
          value={to}
          onChange={(e) => onChangeTo(e.target.value)}
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
          onChange={(e) => onChangeMonthsBack(e.target.value)}
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
          onChange={(e) => onChangeLimit(e.target.value)}
          className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={sync} onChange={(e) => onToggleSync(e.target.checked)} />
        同期する
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={force} onChange={(e) => onToggleForce(e.target.checked)} />
        force
      </label>

      <button
        onClick={onRun}
        disabled={loading}
        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        type="button"
      >
        {loading ? "実行中..." : "ランキング更新"}
      </button>
    </div>
  );
}

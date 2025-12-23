"use client";

import React from "react";

import { RequestControls } from "@/components/scoreboard/request-controls";
import { ScoreboardTable } from "@/components/scoreboard/scoreboard-table";
import { SummaryBanner } from "@/components/scoreboard/summary-banner";
import { WeightInputs } from "@/components/scoreboard/weight-inputs";
import { useScoreboardController } from "@/lib/scoreboard/use-scoreboard-controller";

function fmt(value: number, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

export default function ScoreboardClient() {
  const {
    params,
    weights,
    loading,
    err,
    api,
    rows,
    setTo,
    setMonthsBack,
    setLimit,
    setSync,
    setForce,
    handleWeightChange,
    run,
  } = useScoreboardController();

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <RequestControls
        to={params.to}
        monthsBack={params.monthsBack}
        limit={params.limit}
        sync={params.sync}
        force={params.force}
        loading={loading}
        onChangeTo={setTo}
        onChangeMonthsBack={setMonthsBack}
        onChangeLimit={setLimit}
        onToggleSync={setSync}
        onToggleForce={setForce}
        onRun={run}
      />

      <WeightInputs weights={weights} onChange={handleWeightChange} />

      {err ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </div>
      ) : null}

      {api ? <SummaryBanner api={api} /> : null}

      <ScoreboardTable rows={rows} formatNumber={fmt} />
    </div>
  );
}

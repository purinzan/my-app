import React from "react";
import type { ScoreWeights } from "@/lib/scoreboard/types";

type WeightInputsProps = {
  weights: ScoreWeights;
  onChange: (key: keyof ScoreWeights, value: string) => void;
};

export function WeightInputs({ weights, onChange }: WeightInputsProps) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
      {(
        [
          ["w_ret", "w_ret"],
          ["w_volchg", "w_volchg"],
          ["w_volat", "w_volat"],
          ["w_mom", "w_mom"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="rounded-xl border border-slate-200 p-2 text-xs dark:border-slate-800">
          <div className="text-slate-500">{label}</div>
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1"
            value={weights[key]}
            onChange={(e) => onChange(key, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

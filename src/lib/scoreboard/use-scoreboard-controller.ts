import { useCallback, useMemo, useState } from "react";
import type { Api, Item, ScoreWeights } from "./types";

const weightKeys = ["w_ret", "w_volchg", "w_volat", "w_mom"] as const;

const defaultWeights: ScoreWeights = {
  w_ret: 0.35,
  w_volchg: 0.25,
  w_volat: 0.2,
  w_mom: 0.2,
};

const defaultParams = {
  to: new Date().toISOString().slice(0, 10),
  monthsBack: 3,
  limit: 100,
  sync: true,
  force: false,
};

type ClampRange = { min?: number; max?: number };

function clampNumber(input: string, fallback: number, { min, max }: ClampRange = {}) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

export function useScoreboardController() {
  const [params, setParams] = useState(defaultParams);
  const [weights, setWeights] = useState<ScoreWeights>(defaultWeights);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [api, setApi] = useState<Api | null>(null);

  const rows = useMemo<Item[]>(() => api?.items ?? [], [api]);

  const updateParam = useCallback(
    (key: keyof typeof defaultParams, clampRange?: ClampRange) =>
      (value: string | boolean) => {
        setParams((prev) => {
          if (key === "sync" || key === "force") {
            return { ...prev, [key]: Boolean(value) };
          }
          if (key === "to") {
            return { ...prev, to: String(value) };
          }

          const fallback = prev[key] as number;
          return { ...prev, [key]: clampNumber(String(value), fallback, clampRange) };
        });
      },
    [],
  );

  const handleWeightChange = useCallback((key: keyof ScoreWeights, value: string) => {
    setWeights((prev) => ({
      ...prev,
      [key]: clampNumber(value, prev[key]),
    }));
  }, []);

  const run = useCallback(async () => {
    if (!params.to) {
      setErr("日付を入力してください (YYYY-MM-DD)");
      return;
    }

    setLoading(true);
    setErr("");
    setApi(null);

    try {
      const qs = new URLSearchParams();
      qs.set("to", params.to);
      qs.set("monthsBack", String(params.monthsBack));
      qs.set("limit", String(params.limit));
      qs.set("sync", params.sync ? "1" : "0");
      qs.set("force", params.force ? "1" : "0");
      weightKeys.forEach((key) => qs.set(key, String(weights[key])));
      qs.set("debug", "1");

      const res = await fetch(`/api/scoreboard?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as Api;

      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setApi(json);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [params, weights]);

  return {
    params,
    weights,
    loading,
    err,
    api,
    rows,
    setTo: updateParam("to"),
    setMonthsBack: updateParam("monthsBack", { min: 1, max: 24 }),
    setLimit: updateParam("limit", { min: 10, max: 500 }),
    setSync: updateParam("sync"),
    setForce: updateParam("force"),
    handleWeightChange,
    run,
  };
}

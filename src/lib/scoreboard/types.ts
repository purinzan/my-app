export type Item = {
  rank: number;
  code: string;
  company: Record<string, string> | null;
  score: number;
  ret_mean: number;
  volchg_ratio: number;
  volat_rto_mean: number;
  mom_n_days: number;
};

export type Api = {
  ok: boolean;
  range: { from: string; to: string };
  params: unknown;
  sync: { requestedDays: number; fetchedDays: number; skippedDays: number; quotes: number; upserted: number };
  universe: { barsInDb: number; codesWithBars: number; scoredCodes: number };
  company: { loaded: number; missingCompanyInTop: number };
  items: Item[];
  error?: string;
  debug?: unknown;
};

export type ScoreWeights = {
  w_ret: number;
  w_volchg: number;
  w_volat: number;
  w_mom: number;
};

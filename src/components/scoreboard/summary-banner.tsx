import React from "react";
import type { Api } from "@/lib/scoreboard/types";

type SummaryBannerProps = {
  api: Api;
};

export function SummaryBanner({ api }: SummaryBannerProps) {
  return (
    <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">
      range: {api.range.from} → {api.range.to} / requestedDays: {api.sync.requestedDays} / fetchedDays: {api.sync.fetchedDays} /
      skippedDays: {api.sync.skippedDays} / upserted: {api.sync.upserted} / scoredCodes: {api.universe.scoredCodes} /
      company.loaded: {api.company.loaded} / missingCompanyInTop: {api.company.missingCompanyInTop}
    </div>
  );
}

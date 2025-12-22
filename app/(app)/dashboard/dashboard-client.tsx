"use client";
import Image from "next/image";
import React, {useEffect, useMemo, useRef, useState} from "react";
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from "lightweight-charts";


type GuideStep = 0 | 1 | 2;

const GLOW =
  "ring-4 ring-amber-300 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950";
const GUIDE_STORAGE_KEY = "guide:read-analyze:v2";
const DEFAULT_MASCOT_SRC = "/mascot/robot.png";

function scaleLinear(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
) {
  if (inMax === inMin) return (outMin + outMax) / 2;
  const t = (v - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

async function safeJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) throw new Error(`空のレスポンス (HTTP ${res.status})`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`JSON解析失敗 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}


// --- listed_info.csv helper (会社名/銘柄コードサジェスト) ---
type ListedInfoRow = {
  codeRaw: string; // CSVのCode（例: "72030"）
  code: string; // 末尾0を除いたコード（例: "7203"）
  companyName: string;
  companyNameEnglish: string;
};

function normalizeStockCode(raw: string) {
  const s = String(raw ?? "").trim();
  // J-Quantsの listed_info は 5桁 + 末尾0（例: 72030）が多いので、
  // 「5桁かつ末尾0」だけ安全に 1桁落とす
  if (s.length === 5 && s.endsWith("0")) return s.slice(0, -1);
  return s;
}

function detectDelimiter(headerLine: string) {
  // Excel貼り付け等だとTSVになることがある
  const tab = (headerLine.match(/\t/g) ?? []).length;
  const comma = (headerLine.match(/,/g) ?? []).length;
  return tab > comma ? "\t" : ",";
}

function splitCsvLine(line: string, delim: string) {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // "" はエスケープされたダブルクォート
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === delim) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map((s) => s.trim());
}

function parseListedInfo(csvText: string): ListedInfoRow[] {
  const text = String(csvText ?? "")
    .replace(/^\ufeff/, "") // BOM
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const lines = text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.replace(/^"|"$/g, "").trim());

  const idx = (name: string) => headers.findIndex((h) => h === name);

  const iCode = idx("Code");
  const iName = idx("CompanyName");
  const iEn = idx("CompanyNameEnglish");
  if (iCode < 0 || iName < 0) return [];

  const rows: ListedInfoRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li], delim).map((v) => v.replace(/^"|"$/g, "").trim());
    const codeRaw = String(cols[iCode] ?? "").trim();
    const code = normalizeStockCode(codeRaw);
    const companyName = String(cols[iName] ?? "").trim();
    const companyNameEnglish = String(cols[iEn] ?? "").trim();
    if (!codeRaw || !companyName) continue;
    rows.push({ codeRaw, code, companyName, companyNameEnglish });
  }
  return rows;
}

async function fetchListedInfoCsv(path: string) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) return "";
  const buf = await res.arrayBuffer();

  // まずUTF-8として読む。文字化けっぽければ Shift_JIS も試す（対応ブラウザのみ）
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) {
    try {
      text = new TextDecoder("shift_jis").decode(buf);
    } catch {
      // shift_jis未対応ならUTF-8のまま
    }
  }
  return text;
}


// --- CSV download helper ---
function csvCell(v: unknown) {
  if (v == null) return "";
  const s = String(v);
  // RFC4180-ish: quote when contains comma, quote, or newline
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function candlesToCsv(
  data: { date: string; open: number; high: number; low: number; close: number; volume: number | null }[],
  code: string
) {
  const headers = ["code", "date", "open", "high", "low", "close", "volume"];
  const lines = data.map((d) =>
    [code, d.date, d.open, d.high, d.low, d.close, d.volume == null ? "" : d.volume]
      .map(csvCell)
      .join(",")
  );

  // Excel互換のためUTF-8 BOM + CRLF
  return `\ufeff${headers.join(",")}\r\n${lines.join("\r\n")}`;
}

function downloadCsv(filename: string, csvText: string) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}


function GuideMascot({ src = DEFAULT_MASCOT_SRC }: { src?: string }) {
  return (
    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <Image
        src={src}
        alt="Guide mascot"
        width={64}
        height={64}
        className="h-full w-full rounded-xl object-contain"
        priority
      />
    </div>
  );
}

function GuideSidebar({
  open,
  step,
  hasData,
  analysisDone,
  mascotSrc = DEFAULT_MASCOT_SRC,
  onClose,
  onNext,
  onRestart,
}: {
  open: boolean;
  step: GuideStep;
  hasData: boolean;
  analysisDone: boolean;
  mascotSrc?: string;
  onClose: () => void;
  onNext: () => void;
  onRestart: () => void;
}) {
  if (!open) return null;

  const s = (() => {
    switch (step) {
      case 0:
        return {
          title: "STEP1：データを読み込む",
          lines: ["銘柄コードと期間を選んで『読み込む』を押してね"],
          note: hasData ? "読み込み完了！次はAI分析へ" : "まだデータがありません",
          nextDisabled: !hasData,
        };
      case 1:
        return {
          title: "STEP2：AI分析を実行",
          lines: ["『分析する』でテクニカル要約を作るよ"],
          note: analysisDone ? "分析完了！結果を確認しよう" : "まだ分析していません",
          nextDisabled: !analysisDone,
        };
      default:
        return {
          title: "STEP3：結果を読む",
          lines: [
            "上から順に『要約→MA→サポレジ→メモ』を確認",
            "必要なら下の『追加質問』で深掘りできるよ",
          ],
          note: "『クリア』で分析をやり直せます",
          nextDisabled: false,
        };
    }
  })();

  const steps = [
    { n: 1, label: "読み込み" },
    { n: 2, label: "分析" },
    { n: 3, label: "結果" },
  ] as const;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          ガイド
        </div>
        <button
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          onClick={onClose}
        >
          非表示
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        {steps.map((x, i) => {
          const active = step === i;
          return (
            <div
              key={x.n}
              className={[
                "flex-1 rounded-xl border px-2 py-1 text-center text-[11px]",
                active
                  ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                  : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
              ].join(" ")}
            >
              {x.label}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-start gap-3">
        <GuideMascot src={mascotSrc} />
        <div
          className={[
            "relative flex-1 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800",
            "dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100",
            "after:content-[''] after:absolute after:left-[-20px] after:top-6 after:border-[10px] after:border-transparent after:border-r-slate-200",
            "dark:after:border-r-slate-800",
            "before:content-[''] before:absolute before:left-[-8px] before:top-6 before:border-[10px] before:border-transparent before:border-r-slate-50",
            "dark:before:border-r-slate-900",
          ].join(" ")}
        >
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-200">
            {s.title}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {s.lines.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            {s.note}
          </div>
        </div>
      </div>

    </div>
  );
}

type Candle = {
  date: string; // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  ma5?: number | null;
  ma25?: number | null;
};

type PricesResponse = {
  ok: boolean;
  rid?: string;
  error?: string;
  rows?: Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    code?: string;
  }>;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

type AiAnalysis = {
  summary: string;
  trend: "上昇" | "下降" | "レンジ" | "不明" | null;
  ma: { ma5_vs_ma25: "上昇" | "下降" | "交差" | "レンジ" };
  levels: { support: number[]; resistance: number[] };
  notes: string[];
  disclaimer: string;
};

type FollowupAnswer = {
  answer: string;
  points: string[];
  disclaimer: string;
};

type AnalyzeResponse =
  | { ok: true; kind: "initial"; analysis: AiAnalysis }
  | { ok: true; kind: "followup"; followup: FollowupAnswer }
  | { ok: false; error: string; detail?: any };

type ConversationItem =
  | {
      id: string;
      type: "analysis";
      createdAt: string;
      analysis: AiAnalysis;
    }
  | {
      id: string;
      type: "followup";
      createdAt: string;
      question: string;
      followup: FollowupAnswer;
    }
  | {
      id: string;
      type: "user";
      createdAt: string;
      text: string;
    };

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function AiAnalysisPanel({
  code,
  from,
  to,
  candles,
  highlightAnalyze = false,
  onAnalysisDone,
  onClear,
}: {
  code: string;
  from: string;
  to: string;
  candles: Candle[];
  highlightAnalyze?: boolean;
  onAnalysisDone?: () => void;
  onClear?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hasAnyAnalysis = useMemo(() => items.some((x) => x.type === "analysis"), [items]);

  const baseAnalysis = useMemo(() => {
    const first = items.find((x): x is Extract<ConversationItem, { type: "analysis" }> => x.type === "analysis");
    return first?.analysis ?? null;
  }, [items]);

  const summaryList = useMemo(() => {
    const analyses = items.filter(
      (x): x is Extract<ConversationItem, { type: "analysis" }> => x.type === "analysis"
    );
    return analyses.map((a) => a.analysis.summary).slice(-6);
  }, [items]);

  function badge(text: string, key?: React.Key) {
    return (
      <span
        key={key ?? text}
        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
      >
        {text}
      </span>
    );
  }

  async function runInitial() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          kind: "initial",
          code: code.trim(),
          from,
          to,
          candles: candles.slice(-300),
          note: "",
        }),
      });

      const json = await safeJson<AnalyzeResponse>(res);
      if (!res.ok || !json.ok || json.kind !== "initial") {
        const msg = (json as any)?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const now = new Date().toISOString();
      setItems([
        {
          id: makeId(),
          type: "analysis",
          createdAt: now,
          analysis: json.analysis,
        },
      ]);
      onAnalysisDone?.();
    } catch (e: any) {
      setErr(e?.message ?? "error");
    } finally {
      setLoading(false);
    }
  }

  async function sendFollowup() {
    const q = draft.trim();
    if (!q) return;

    if (!baseAnalysis) {
      setErr("初回分析がまだありません（先に「分析する」を実行してください）");
      return;
    }

    setLoading(true);
    setErr(null);

    const userMsg: ConversationItem = {
      id: makeId(),
      type: "user",
      createdAt: new Date().toISOString(),
      text: q,
    };
    setItems((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          kind: "followup",
          code: code.trim(),
          from,
          to,
          candles: candles.slice(-300),
          question: q,
          summaries: summaryList,
          initial: {
            summary: baseAnalysis.summary,
            trend: baseAnalysis.trend,
            ma5_vs_ma25: baseAnalysis.ma?.ma5_vs_ma25,
            support: baseAnalysis.levels?.support ?? [],
            resistance: baseAnalysis.levels?.resistance ?? [],
          },
        }),
      });

      const json = await safeJson<AnalyzeResponse>(res);
      if (!res.ok || !json.ok || json.kind !== "followup") {
        const msg = (json as any)?.error || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const aiItem: ConversationItem = {
        id: makeId(),
        type: "followup",
        createdAt: new Date().toISOString(),
        question: q,
        followup: json.followup,
      };

      setItems((prev) => [...prev, aiItem]);
      setDraft("");
      // 初回分析済みなら guide 的にはもうOKなので、ここで onAnalysisDone は呼ばなくてOK（呼んでも害はない）
    } catch (e: any) {
      setErr(e?.message ?? "error");
    } finally {
      setLoading(false);
    }
  }

  function clearAll() {
    setItems([]);
    setDraft("");
    setErr(null);
    onClear?.();
  }

  return (
    <div className="w-full max-w-none rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI分析</div>
        <div className="flex gap-2">
          <button
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
            disabled={loading}
            onClick={clearAll}
          >
            クリア
          </button>

          <button
            className={[
              "rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-slate-900",
              highlightAnalyze ? GLOW : "",
              highlightAnalyze ? "animate-pulse" : "",
            ].join(" ")}
            disabled={loading || candles.length < 30}
            onClick={runInitial}
          >
            {loading ? "分析中..." : "分析する"}
          </button>
        </div>
      </div>

      {candles.length < 30 && (
        <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">
          データが少ないため分析できません（最低30本程度必要）
        </div>
      )}

      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

      {/* 会話ログ */}
      {hasAnyAnalysis && (
        <div className="mt-4 space-y-3">
          {items.map((it) => {
            if (it.type === "user") {
              return (
                <div
                  key={it.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    追加質問 • {formatTime(it.createdAt)}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">
                    {it.text}
                  </div>
                </div>
              );
            }

            if (it.type === "analysis") {
              const a = it.analysis;
              return (
                <div
                  key={it.id}
                  className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
                >
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    初回分析 • {formatTime(it.createdAt)}
                  </div>

                  <div className="mt-2 text-sm text-slate-900 dark:text-slate-100">{a.summary}</div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {badge(`トレンド: ${a.trend ?? "-"}`, it.id + "-trend")}
                    {badge(`MA5 vs MA25: ${a.ma.ma5_vs_ma25}`, it.id + "-ma")}
                  </div>

                  <div className="mt-3">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">サポート</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {(a.levels.support ?? []).length
                        ? a.levels.support.map((v, i) => badge(String(v), `${it.id}-support-${v}-${i}`))
                        : badge("-", `${it.id}-support-empty`)}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">レジスタンス</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {(a.levels.resistance ?? []).length
                        ? a.levels.resistance.map((v, i) => badge(String(v), `${it.id}-resist-${v}-${i}`))
                        : badge("-", `${it.id}-resist-empty`)}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">メモ</div>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800 dark:text-slate-200">
                      {(a.notes ?? []).map((s, i) => (
                        <li key={`${it.id}-note-${i}`}>{s}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                    {a.disclaimer}
                  </div>
                </div>
              );
            }

            // followup
            const f = it.followup;
            return (
              <div
                key={it.id}
                className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
              >
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  追加解説 • {formatTime(it.createdAt)}
                </div>

                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-900 dark:text-slate-100">
                  {f.answer}
                </div>

                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">ポイント</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800 dark:text-slate-200">
                    {(f.points ?? []).map((s, i) => (
                      <li key={`${it.id}-pt-${i}`}>{s}</li>
                    ))}
                  </ul>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                  {f.disclaimer}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 追加質問入力（初回分析後のみ） */}
      {hasAnyAnalysis && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            追加メモ（追加質問）
          </div>
          <textarea
            className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="例：サポートの根拠は？／この上昇は出来高を伴ってる？／次に見るべき水準は？"
          />
          <div className="mt-2 flex justify-end">
            <button
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-slate-900"
              disabled={loading || !draft.trim()}
              onClick={sendFollowup}
            >
              {loading ? "送信中..." : "送信"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function addSMA(data: Candle[], period: number, key: "ma5" | "ma25"): Candle[] {
  const out: Candle[] = [];
  const q: number[] = [];
  let sum = 0;

  for (const d of data) {
    const v = d.close;
    q.push(v);
    sum += v;

    if (q.length > period) sum -= q.shift()!;
    const ma = q.length === period ? sum / period : null;
    out.push({ ...d, [key]: ma });
  }
  return out;
}

function normalizeChartDate(s: string) {
  // accepts: "YYYY-MM-DD", "YYYY/MM/D", "YYYY-MM-DDTHH:mm:ssZ" etc.
  const base = String(s).slice(0, 10);
  const m = base.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return base;
  const y = m[1];
  const mm = m[2].padStart(2, "0");
  const dd = m[3].padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function TvCandleChart({ data, height = 380 }: { data: Candle[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const ma5SeriesRef = useRef<any>(null);
  const ma25SeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);


  // create chart (once)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isDark = document.documentElement.classList.contains("dark");

    const chart = createChart(el, {
      width: el.clientWidth || 600,
      height,
      layout: {
        textColor: isDark ? "#e2e8f0" : "#0f172a",
        background: { type: "solid", color: isDark ? "#020617" : "#ffffff" },
      },
      grid: {
        vertLines: { color: isDark ? "rgba(148,163,184,0.10)" : "rgba(15,23,42,0.10)" },
        horzLines: { color: isDark ? "rgba(148,163,184,0.10)" : "rgba(15,23,42,0.10)" },
      },
      rightPriceScale: { borderColor: isDark ? "rgba(148,163,184,0.25)" : "rgba(15,23,42,0.20)" },
      leftPriceScale: { visible: true, ticksVisible: true }, // ← 出来高用に左を表示
      timeScale: { borderColor: isDark ? "rgba(148,163,184,0.25)" : "rgba(15,23,42,0.20)" },
    });

    // MA series first (so it sits under candles)
    const ma5 = chart.addSeries(LineSeries, { lineWidth: 1, color: "rgba(59,130,246,0.95)" });
    const ma25 = chart.addSeries(LineSeries, { lineWidth: 1, color: "rgba(245,158,11,0.95)" });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });

    // ✅ 追加：出来高（Histogram）
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "left",         // overlay（同一チャート内）
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // 表示領域を分割（上：価格、下：出来高）
    // 出来高（左軸）は下30%あたり
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });

    // 価格（右軸）は上側
    candle.priceScale().applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.30 },
    });

    // ref保存
    chartRef.current = chart;
    candleSeriesRef.current = candle;
    ma5SeriesRef.current = ma5;
    ma25SeriesRef.current = ma25;
    volumeSeriesRef.current = volume;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      chart.applyOptions({ width: Math.floor(cr.width), height });
      chart.timeScale().fitContent();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      ma5SeriesRef.current = null;
      ma25SeriesRef.current = null;
      volumeSeriesRef.current = null;

    };
  }, [height]);

  // push data into chart
  useEffect(() => {
    if (!data?.length) return;

    const candle = candleSeriesRef.current;
    const ma5 = ma5SeriesRef.current;
    const ma25 = ma25SeriesRef.current;
    const chart = chartRef.current;
    if (!candle || !ma5 || !ma25 || !chart) return;

    // Lightweight Charts v5 Time accepts business-day ISO strings "YYYY-MM-DD"
    const bars = data.map((d) => ({
      time: normalizeChartDate(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    const ma5Data = data.map((d) =>
      d.ma5 == null ? { time: normalizeChartDate(d.date) } : { time: normalizeChartDate(d.date), value: d.ma5 }
    );
    const ma25Data = data.map((d) =>
      d.ma25 == null ? { time: normalizeChartDate(d.date) } : { time: normalizeChartDate(d.date), value: d.ma25 }
    );
    const volume = volumeSeriesRef.current;
    if (!candle || !ma5 || !ma25 || !volume || !chart) return;

    const volumeData = data.map((d) => {
      const time = normalizeChartDate(d.date);
      if (d.volume == null) return { time }; // volume欠損日は空白
      const up = d.close >= d.open;
      return {
        time,
        value: d.volume,
        color: up ? "rgba(22,163,74,0.45)" : "rgba(220,38,38,0.45)", // 上げ/下げで色
      };
    });

    candle.setData(bars as any);
    ma5.setData(ma5Data as any);
    ma25.setData(ma25Data as any);
    volume.setData(volumeData as any);

    chart.timeScale().fitContent();

  }, [data]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div ref={containerRef} style={{ width: "100%", height }} />
      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">MA5（青） / MA25（橙）</div>
    </div>
  );
}

export default function DashboardClient() {
  const [code, setCode] = useState("7203");
  const isoLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const [to, setTo] = useState(() => isoLocal(new Date()));
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return isoLocal(d);
  });


  const [allData, setAllData] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<{ effectiveFrom?: string | null; effectiveTo?: string | null }>({});
  const hasData = allData.length > 0;

  const [guideOpen, setGuideOpen] = useState(true);
  const [guideStep, setGuideStep] = useState<GuideStep>(0);
  const [analysisDone, setAnalysisDone] = useState(false);

  // listed_info.csv (会社名/銘柄コードのサジェスト用)
  const [listed, setListed] = useState<ListedInfoRow[]>([]);
  const [companyName, setCompanyName] = useState("トヨタ自動車");
  const [openCompanySuggest, setOpenCompanySuggest] = useState(false);
  const [openCodeSuggest, setOpenCodeSuggest] = useState(false);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await fetchListedInfoCsv("/listed_info.csv");
        if (!text) return;
        const parsed = parseListedInfo(text);
        if (!cancelled) setListed(parsed);
      } catch {
        // CSVが無い/読めない場合はサジェストなしで動作
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(GUIDE_STORAGE_KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (typeof v?.open === "boolean") setGuideOpen(v.open);
      if (v?.step === 0 || v?.step === 1 || v?.step === 2) setGuideStep(v.step);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify({ open: guideOpen, step: guideStep }));
    } catch {}
  }, [guideOpen, guideStep]);

  useEffect(() => {
    if (!hasData) {
      setGuideStep(0);
      setAnalysisDone(false);
      return;
    }
    setGuideStep((s) => (s === 0 ? 1 : s));
  }, [hasData]);

  useEffect(() => {
    if (hasData && analysisDone) setGuideStep(2);
  }, [hasData, analysisDone]);

  const highlightLoad = guideOpen && !hasData;
  const highlightAnalyze = guideOpen && hasData && !analysisDone;

  const companySuggestions = useMemo(() => {
    const q = companyName.trim();
    if (!q) return [];
    const qLower = q.toLowerCase();
    return listed
      .filter((x) => x.companyName.includes(q) || x.companyNameEnglish.toLowerCase().includes(qLower))
      .slice(0, 12);
  }, [companyName, listed]);

  const codeSuggestions = useMemo(() => {
    const q = code.trim().replace(/[^0-9]/g, "");
    if (!q) return [];
    const qNorm = normalizeStockCode(q);
    return listed
      .filter((x) => x.code.startsWith(qNorm) || x.codeRaw.startsWith(q))
      .slice(0, 12);
  }, [code, listed]);

  function applyListing(x: ListedInfoRow) {
    setCompanyName(x.companyName);
    setCode(x.code); // 末尾0を除去したコードを採用
    setOpenCompanySuggest(false);
    setOpenCodeSuggest(false);
  }

  async function fetchPrices(sync = true) {
    setLoading(true);
    setErr(null);

    try {
      const url = new URL("/api/prices", window.location.origin);
      url.searchParams.set("code", code.trim());
      url.searchParams.set("from", from);
      url.searchParams.set("to", to);

      if (sync) {
        url.searchParams.set("sync", "1");
        url.searchParams.set("syncMode", "auto");
      } else {
        url.searchParams.set("sync", "0");
      }

      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = await safeJson<PricesResponse>(res);

      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);

      const rows = (json.rows ?? [])
        .filter((r) => r.open != null && r.high != null && r.low != null && r.close != null)
        .map((r) => ({
          date: String(r.date),
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: r.volume == null ? null : Number(r.volume),
        }));

      setInfo({ effectiveFrom: json.effectiveFrom ?? null, effectiveTo: json.effectiveTo ?? null });

      const withMA = addSMA(addSMA(rows, 5, "ma5"), 25, "ma25");
      setAllData(withMA);
    } catch (e: any) {
      setErr(e?.message ?? "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">会社名</div>
              <input
                className="mt-1 w-80 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  setOpenCompanySuggest(true);
                  setOpenCodeSuggest(false);
                }}
                onFocus={() => {
                  setOpenCompanySuggest(true);
                  setOpenCodeSuggest(false);
                }}
                onBlur={() => setOpenCompanySuggest(false)}
                placeholder="極洋 / KYOKUYO"
              />

              {openCompanySuggest && companySuggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-[28rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-950">
                  {companySuggestions.map((x) => (
                    <button
                      key={x.codeRaw + ":" + x.companyName}
                      type="button"
                      className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyListing(x);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {x.companyName}
                          </div>
                          {x.companyNameEnglish ? (
                            <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                              {x.companyNameEnglish}
                            </div>
                          ) : null}
                        </div>
                        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                          {x.code}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {listed.length === 0 ? (
                <div className="mt-1 text-[11px] text-slate-400">
                  サジェスト用CSV: public/listed_info.csv
                </div>
              ) : null}
            </div>

            <div className="relative">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">銘柄コード</div>
              <input
                className="mt-1 w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/[^0-9]/g, ""));
                  setOpenCodeSuggest(true);
                  setOpenCompanySuggest(false);
                }}
                onFocus={() => {
                  setOpenCodeSuggest(true);
                  setOpenCompanySuggest(false);
                }}
                onBlur={() => {
                  setOpenCodeSuggest(false);
                  setCode((v) => normalizeStockCode(v));
                }}
                placeholder="7203"
              />

              {openCodeSuggest && codeSuggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-950">
                  {codeSuggestions.map((x) => (
                    <button
                      key={x.codeRaw + ":" + x.companyName}
                      type="button"
                      className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyListing(x);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-14 shrink-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {x.code}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">
                          {x.companyName}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">from</div>
              <input
                type="date"
                className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">to</div>
              <input
                type="date"
                className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                className={[
                  "rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-slate-900",
                  highlightLoad ? GLOW : "",
                  highlightLoad ? "animate-pulse" : "",
                ].join(" ")}
                disabled={loading}
                onClick={() => fetchPrices(true)}
              >
                {loading ? "読み込み中..." : "読み込む"}
              </button>

              {hasData && (
                <button
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                  onClick={() => {
                    const c = code.trim();
                    const csv = candlesToCsv(allData, c);
                    downloadCsv(`${c}_${from}_${to}.csv`, csv);
                  }}
                >
                  CSV
                </button>
              )}
            </div>

          </div>

          {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
        </div>

        {!hasData ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            データがありません（銘柄/期間を確認して「読み込み」を押してください）
          </div>
        ) : (
          <div className="space-y-4">
            <TvCandleChart data={allData} height={260} />
            <AiAnalysisPanel
              code={code}
              from={from}
              to={to}
              candles={allData}
              highlightAnalyze={highlightAnalyze}
              onAnalysisDone={() => setAnalysisDone(true)}
              onClear={() => setAnalysisDone(false)}
            />
          </div>
        )}
      </div>

      <div className="hidden w-80 shrink-0 lg:block">
        <GuideSidebar
          open={guideOpen}
          step={guideStep}
          hasData={hasData}
          analysisDone={analysisDone}
          mascotSrc={DEFAULT_MASCOT_SRC}
          onClose={() => setGuideOpen(false)}
          onNext={() => setGuideStep((s) => (s < 2 ? ((s + 1) as GuideStep) : 2))}
          onRestart={() => {
            setGuideOpen(true);
            setGuideStep(hasData ? (analysisDone ? 2 : 1) : 0);
          }}
        />
      </div>
    </div>
  );
}

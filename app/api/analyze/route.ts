import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Candle ----
const CandleSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nullable().optional(),
});
type Candle = z.infer<typeof CandleSchema>;

// ---- Output Schemas ----
const AnalysisSchema = z.object({
  summary: z.string(),
  trend: z.enum(["上昇", "下降", "レンジ", "不明"]).nullable(),
  ma: z.object({
    ma5_vs_ma25: z.enum(["上昇", "下降", "交差", "レンジ"]),
  }),
  levels: z.object({
    support: z.array(z.number()).max(3),
    resistance: z.array(z.number()).max(3),
  }),
  notes: z.array(z.string()).max(8),
  disclaimer: z.string(),
});

const FollowupSchema = z.object({
  answer: z.string(), // 3〜10文（改行OK）
  points: z.array(z.string()).min(3).max(6),
  disclaimer: z.string(),
});

// ---- Request Schemas ----
const BaseReq = z.object({
  code: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  candles: z.array(CandleSchema).min(30),
});

const InitialReqSchema = BaseReq.extend({
  kind: z.literal("initial").optional(),
  note: z.string().optional(),
});

const FollowupReqSchema = BaseReq.extend({
  kind: z.literal("followup"),
  question: z.string().min(1),
  summaries: z.array(z.string()).optional(),
  initial: z
    .object({
      summary: z.string().optional(),
      trend: z.enum(["上昇", "下降", "レンジ", "不明"]).nullable().optional(),
      ma5_vs_ma25: z.enum(["上昇", "下降", "交差", "レンジ"]).optional(),
      support: z.array(z.number()).optional(),
      resistance: z.array(z.number()).optional(),
    })
    .optional(),
});

const RequestSchema = z.union([InitialReqSchema, FollowupReqSchema]);

function addSMA(values: number[], period: number) {
  const out: (number | null)[] = [];
  const q: number[] = [];
  let sum = 0;
  for (const v of values) {
    q.push(v);
    sum += v;
    if (q.length > period) sum -= q.shift()!;
    out.push(q.length === period ? sum / period : null);
  }
  return out;
}

function logPrompt(tag: string, prompt: string) {
  // 本番で抑制したければ NODE_ENV や env フラグで分岐してOK
  console.log(
    `===== AI PROMPT (${tag} len=${prompt.length}) =====\n${prompt}\n===== /AI PROMPT =====`
  );
}

function tailCandles(candles: Candle[], n = 60) {
  return candles
    .slice(-n)
    .map((r) => `${r.date} O:${r.open} H:${r.high} L:${r.low} C:${r.close}`)
    .join("\n");
}

export async function POST(req: Request) {
  // 1) parse json
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON", detail: String(e?.message ?? e) },
      { status: 400 }
    );
  }

  // 2) validate
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Bad request", detail: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;

  // 3) normalize candles (念のため null 混入を排除)
  const candles = body.candles
    .filter(
      (r) =>
        Number.isFinite(r.open) &&
        Number.isFinite(r.high) &&
        Number.isFinite(r.low) &&
        Number.isFinite(r.close)
    )
    .map((r) => ({
      date: String(r.date),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: r.volume == null ? null : Number(r.volume),
    }));

  if (candles.length < 30) {
    return NextResponse.json(
      { ok: false, error: "データが少なすぎます（最低30本くらい欲しい）" },
      { status: 400 }
    );
  }

  // ---- derived metrics ----
  const closes = candles.map((r) => r.close);
  const ma5 = addSMA(closes, 5);
  const ma25 = addSMA(closes, 25);

  const last = candles.length - 1;
  const lastClose = closes[last];
  const lastMa5 = ma5[last];
  const lastMa25 = ma25[last];
  const hi = Math.max(...candles.map((r) => r.high));
  const lo = Math.min(...candles.map((r) => r.low));
  const candlesSorted = [...candles].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const tail60Arr = candlesSorted.slice(-60);
  const tail3Arr  = tail60Arr.slice(-3);

  const tail = tail60Arr
    .map((r) => `${r.date} O:${r.open} H:${r.high} L:${r.low} C:${r.close}`)
    .join("\n");

  const tail3 = tail3Arr
    .map((r) => `${r.date} O:${r.open} H:${r.high} L:${r.low} C:${r.close}`)
    .join("\n");

  // 確認ログ（最新3本の日付が出る）
  console.log("tail3 dates:", tail3Arr.map(r => r.date));

  try {
    // =========================
    // INITIAL
    // =========================
    if (!("kind" in body) || body.kind !== "followup") {
      const note = typeof (body as any).note === "string" ? String((body as any).note) : "";

  const prompt = `
 あなたは株価をテクニカル分析してください。
【最重要】出力はJSONオブジェクトのみ。Markdown/前置き/コメント/キー追加/省略は禁止。
返却JSONのキー・構造は固定：
{
  "summary": "…",
  "trend": "",
  "ma": { "ma5_vs_ma25": "" },
  "levels": { "support": [], "resistance": [] },
  "notes": [],
  "disclaimer": "…"
}

■summary（必須）
-  株を買いから入るか、売りから入るか、またいくらになったときに行いたいかをテクニカルの観点から発言し、その理由を説明してください。
- 各行は人間向けの短文で、必ず数値（%/円/回数/比率）を含める
- 曖昧語（推定/程度/〜っぽい/寄り/約）は禁止。出せない値は「算出不能（理由）」と書く

■計算・判定（最小ルール）
1) MA（SMA）
- closeからSMA5/SMA25を可能な範囲で算出。算出不能なら最新値のみ参考MAを使用してよい

2) ma5_vs_ma25
- 上昇下降を判断

3) trend
- 上昇、下降、レンジか判断

4) MA反応（直近20本）
- touch: 終値がMA25±0.50%に入る回数
- reaction: touch後3本以内に終値がMA25から±1.00%以上離れる回数
- touch<1なら「判断不能」とし、回数と理由を出す

5) 直近足（最新3本）
- 直近の勢いをローソク足と移動平均の傾きから算出

6) ボラ・乱高下
-乱高下有り無し判断

7) 重要価格帯（levels）
- レジサポを入力
- support/resistanceは各0〜3個、なければ[]。数値は必ずnumber

■notes（0〜8）
- 人間向け短文。各要素に必ず数値。summaryの補足（計算結果・回数・閾値判定）を書く
- summaryと矛盾しない（同じ数値は同じ値を再利用）

■disclaimer（必須）
- 「提供データ（期間内/直近60本）の説明であり、将来予測や売買推奨ではない」

────────────────────────
【入力（この情報だけ使う）】
────────────────────────
銘柄: ${body.code}
期間: ${body.from}〜${body.to}
本数: ${candles.length}

ユーザー追加メモ/追加質問:
${note || "(なし)"}

最終終値(円): ${lastClose}
（参考）MA5: ${lastMa5 ?? "N/A"}
（参考）MA25: ${lastMa25 ?? "N/A"}


直近60本（date, open, high, low, close）:
${tail}


出力：AnalysisSchemaに完全準拠したJSONのみ（キー固定、余計な文章禁止）。
summaryは6行（\n区切り）で、人間向けの短文＋必ず数値。
notesは最大8個で、人間向けの短文＋必ず数値
disclaimer には必ず次の趣旨を含める（1回だけ）：
「提供データ（期間内/直近60本）の説明であり、将来予測や売買推奨ではない」
`
.trim();

      logPrompt(`initial code=${body.code} from=${body.from} to=${body.to}`, prompt);

      const { object } = await generateObject({
        model: "openai/gpt-5.1-thinking",
        schema: AnalysisSchema,
        prompt,
      });

      return NextResponse.json({ ok: true, kind: "initial", analysis: object });
    }

    // =========================
    // FOLLOWUP
    // =========================
    const init = body.initial ?? {};
    const initTrend = init.trend ?? "(なし)";
    const initMaRel = init.ma5_vs_ma25 ?? "(なし)";
    const initSupport =
      (init.support ?? []).length > 0 ? (init.support ?? []).join(", ") : "(なし)";
    const initResistance =
      (init.resistance ?? []).length > 0 ? (init.resistance ?? []).join(", ") : "(なし)";
    const initSummary = init.summary ?? "(なし)";

    const summaries = (body.summaries ?? []).slice(-6);
    const followupPrompt = `
あなたは株価テクニカル分析アシスタントです。
ユーザーの「追加質問」に対して、初めのAI回答に基づいて追加で解説して

【初回AIのスナップショット（参照用・更新しない）】
summary: ${initSummary}
trend: ${initTrend}
ma5_vs_ma25: ${initMaRel}
support: ${initSupport}
resistance: ${initResistance}

これまでの分析要約（最大6件）:
${summaries.length ? summaries.map((s, i) => `#${i + 1}: ${s}`).join("\n") : "(なし)"}

追加質問:
${body.question || "(なし)"}

銘柄: ${body.code}
期間: ${body.from}〜${body.to}
本数: ${candles.length}

最終終値: ${lastClose}
MA5: ${lastMa5 ?? "N/A"}
MA25: ${lastMa25 ?? "N/A"}
期間高値: ${hi}
期間安値: ${lo}

直近60本（date, open, high, low, close）:
${tail}

必ず「次のスキーマ通りのJSONオブジェクト」だけを返してください（余計な文章は禁止）。
- answer: 3〜10文（必要なら改行OK）
- points: 3〜6個
- disclaimer: 必須
`.trim();

    logPrompt(
      `followup code=${body.code} from=${body.from} to=${body.to}`,
      followupPrompt
    );

    const { object } = await generateObject({
      model: "openai/gpt-4o-mini",
      schema: FollowupSchema,
      prompt: followupPrompt,
    });

    return NextResponse.json({ ok: true, kind: "followup", followup: object });
  } catch (e: any) {
    console.error("[/api/analyze] error:", e);
    return NextResponse.json(
      { ok: false, error: "Internal error", detail: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

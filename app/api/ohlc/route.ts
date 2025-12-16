import { NextResponse } from "next/server";

type OhlcRow = {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Date -> "YYYY-MM-DD" (UTC) */
function toISODateUTC(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Parse "YYYY-MM-DD" as a UTC date (00:00:00Z). Returns null if invalid. */
function parseISODateUTC(s: string | null): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const [yy, mm, dd] = s.split("-").map((x) => Number(x));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;

  const d = new Date(Date.UTC(yy, mm - 1, dd));
  // Reject impossible dates (e.g., 2025-02-30)
  if (d.getUTCFullYear() !== yy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return d;
}

/** Inclusive number of days between two UTC dates (assumes both at 00:00Z) */
function daysBetweenInclusive(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86400000) + 1;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const code = (searchParams.get("code") ?? "00000").trim() || "00000";
  const fromQ = searchParams.get("from");
  const toQ = searchParams.get("to");

  // to: default today (UTC, date-only)
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const toDate = parseISODateUTC(toQ) ?? todayUTC;

  // from: default last 60 points (inclusive)
  const fromDate =
    parseISODateUTC(fromQ) ??
    new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate() - 59));

  if (fromQ && !parseISODateUTC(fromQ)) {
    return NextResponse.json(
      { ok: false, error: "Invalid `from`. Use YYYY-MM-DD." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }
  if (toQ && !parseISODateUTC(toQ)) {
    return NextResponse.json(
      { ok: false, error: "Invalid `to`. Use YYYY-MM-DD." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (fromDate.getTime() > toDate.getTime()) {
    return NextResponse.json(
      { ok: false, error: "`from` must be <= `to`." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Safety: cap too-large requests
  const MAX_POINTS = 2000;
  const n = daysBetweenInclusive(fromDate, toDate);
  if (n > MAX_POINTS) {
    return NextResponse.json(
      { ok: false, error: `Too many points (${n}). Please narrow the range (max ${MAX_POINTS}).` },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Dummy OHLC generation (deterministic-ish per code + day index)
  const out: OhlcRow[] = [];
  let price = 1000 + (Number(code.slice(-2)) || 0) * 10;

  for (let i = 0; i < n; i++) {
    const d = new Date(fromDate);
    d.setUTCDate(fromDate.getUTCDate() + i);

    const open = price;

    // Smooth-ish pattern + small drift
    const move = Math.sin(i / 6) * 15 + (i % 5) * 2;
    const close = Math.max(1, Math.round(open + move));
    const high = Math.max(open, close) + (i % 7) * 3 + 5;
    const low = Math.min(open, close) - (i % 6) * 3 - 5;

    // Optional dummy volume
    const volume = 100000 + ((i * 7919 + (Number(code.slice(-3)) || 0) * 97) % 50000);

    out.push({
      date: toISODateUTC(d),
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(low),
      close: Math.round(close),
      volume,
    });

    price = close;
  }

  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}

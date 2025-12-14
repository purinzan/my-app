import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { pricesDaily } from "@/lib/db/schema";
import { and, asc, eq, gte, lte } from "drizzle-orm";

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    if (!code) {
      return NextResponse.json({ ok: false, error: "missing code" }, { status: 400 });
    }

    // from/to は任意。なければ直近60日を返す
    const to = searchParams.get("to") ?? isoDate(new Date());
    const from =
      searchParams.get("from") ??
      isoDate(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));

    const rows = await db
      .select()
      .from(pricesDaily)
      .where(and(eq(pricesDaily.code, code), gte(pricesDaily.date, from), lte(pricesDaily.date, to)))
      .orderBy(asc(pricesDaily.date));

    return NextResponse.json({ ok: true, code, from, to, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 });
  }
}

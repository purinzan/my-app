// app/api/jquants/daily/route.ts
import { NextResponse } from "next/server";
import { syncDailyQuotesToDB } from "@/lib/jquants";

export async function GET(req: Request) {
  const rid = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get("code") ?? "").trim();
    const from = (searchParams.get("from") ?? "").trim();
    const to = (searchParams.get("to") ?? "").trim();

    if (!code || !from || !to) {
      return NextResponse.json(
        { ok: false, rid, error: "missing code/from/to" },
        { status: 400 }
      );
    }

    console.log(`[jqdaily:${rid}] start`, { code, from, to });

    const r = await syncDailyQuotesToDB({ code, from, to });

    console.log(`[jqdaily:${rid}] done`, r);

    return NextResponse.json({
      ok: true,
      rid,
      code,
      from,
      to,
      ...r,
    });
  } catch (e: any) {
    console.error(`[jqdaily:${rid}] ERROR`, e?.message ?? e);
    return NextResponse.json({ ok: false, rid, error: e?.message ?? "error" }, { status: 500 });
  }
}

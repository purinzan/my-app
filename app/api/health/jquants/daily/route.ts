import { NextResponse } from "next/server";

const BASE = "https://api.jquants.com/v1";

async function getIdToken(refreshToken: string) {
  const res = await fetch(`${BASE}/token/auth_refresh?refreshtoken=${encodeURIComponent(refreshToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`auth_refresh failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { idToken: string };
  return data.idToken;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code"); // 例: 7203
    const date = searchParams.get("date"); // 例: 2025-12-13 (任意)

    if (!code) {
      return NextResponse.json({ ok: false, error: "missing code" }, { status: 400 });
    }

    const refreshToken = process.env.JQUANTS_REFRESH_TOKEN;
    if (!refreshToken) {
      return NextResponse.json({ ok: false, error: "missing JQUANTS_REFRESH_TOKEN" }, { status: 500 });
    }

    const idToken = await getIdToken(refreshToken);

    // 日足：/prices/daily_quotes?code=xxxx&date=YYYY-MM-DD（dateは任意）
    const url = new URL(`${BASE}/prices/daily_quotes`);
    url.searchParams.set("code", code);
    if (date) url.searchParams.set("date", date);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `daily_quotes failed: ${res.status}`, detail: await res.text() },
        { status: 500 }
      );
    }

    const data = await res.json();
    return NextResponse.json({ ok: true, code, date: date ?? null, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

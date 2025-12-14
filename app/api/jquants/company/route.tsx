import { NextResponse } from "next/server";

const BASE = "https://api.jquants.com/v1";

async function getIdToken(refreshToken: string) {
  const url = new URL(`${BASE}/token/auth_refresh`);
  url.searchParams.set("refreshtoken", refreshToken);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`auth_refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { idToken: string };
  return data.idToken;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const date = searchParams.get("date"); // 任意: "YYYY-MM-DD"

    if (!code) return NextResponse.json({ ok: false, error: "missing code" }, { status: 400 });

    const refreshToken = process.env.JQUANTS_REFRESH_TOKEN;
    if (!refreshToken) {
      return NextResponse.json({ ok: false, error: "missing JQUANTS_REFRESH_TOKEN" }, { status: 500 });
    }

    const idToken = await getIdToken(refreshToken);

    const url = new URL(`${BASE}/listed/info`);
    url.searchParams.set("code", code);
    if (date) url.searchParams.set("date", date);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `listed/info failed: ${res.status}`, detail: await res.text() }, { status: 500 });
    }

    const data = (await res.json()) as { info?: any[] };
    const info = Array.isArray(data.info) ? data.info : [];

    // Dateが最新のものを選ぶ（なければ先頭）
    const latest = info
      .slice()
      .sort((a, b) => String(a.Date ?? "").localeCompare(String(b.Date ?? "")))
      .at(-1);

    return NextResponse.json({
      ok: true,
      code,
      companyName: latest?.CompanyName ?? null,
      companyNameEnglish: latest?.CompanyNameEnglish ?? null,
      asOf: latest?.Date ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

/**
 * GET /api/users
 *
 * - 200 OK: { ok: true, user: { id: string } }
 * - 400 Bad Request: { ok: false, error: string } when validation fails
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, user: { id } });
}

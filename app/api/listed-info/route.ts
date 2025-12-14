import { NextResponse } from "next/server";

export async function GET() {
  // ✅ まずは表示確認用（必要ならCSV/DB/APIに置き換え）
  return NextResponse.json([
    { Code: "72030", CompanyName: "トヨタ自動車" },
    { Code: "67580", CompanyName: "ソニーグループ" },
  ]);
}

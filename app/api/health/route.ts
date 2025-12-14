export async function GET() {
  return Response.json({
    ok: true,
    message: "healthy",
    timestamp: new Date().toISOString(),
  });
}

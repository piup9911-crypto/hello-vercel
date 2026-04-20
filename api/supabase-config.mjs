export function GET() {
  const url = process.env.SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  const configured = Boolean(url && anonKey);

  return new Response(
    JSON.stringify({
      configured,
      url: configured ? url : "",
      anonKey: configured ? anonKey : "",
      message: configured
        ? "ok"
        : "Missing SUPABASE_URL or SUPABASE_ANON_KEY",
    }),
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "application/json; charset=utf-8",
      },
      status: configured ? 200 : 503,
    },
  );
}

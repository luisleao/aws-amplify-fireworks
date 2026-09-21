import { getPublisherConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diz qual transporte o backend está usando — útil para conferir o deploy. */
export async function GET() {
  const publisher = getPublisherConfig();
  return Response.json({
    ok: true,
    transport: publisher ? "appsync-events" : "local-sse",
    channel: publisher?.channel ?? null,
    region: publisher?.region ?? null,
  });
}

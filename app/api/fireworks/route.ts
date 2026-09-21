import type { NextRequest } from "next/server";

import { getPublisherConfig } from "@/lib/config";
import { createFireworkEvent, parseFireworkRequest } from "@/lib/fireworks";
import { publishLocal } from "@/lib/local-bus";
import { takeToken } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Um pedido válido tem ~50 bytes; qualquer coisa maior é ruído. */
const MAX_BODY_BYTES = 1024;

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }

  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  const limit = takeToken(clientIp);
  if (!limit.ok) {
    return Response.json(
      { error: "rate_limited", retryAfterMs: limit.retryAfterMs },
      { status: 429, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  const body = await request.json().catch(() => null);
  const fireworkRequest = parseFireworkRequest(body);
  if (!fireworkRequest) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const event = createFireworkEvent(fireworkRequest);
  const publisher = getPublisherConfig();

  try {
    if (publisher) {
      // Import tardio: no modo local o SDK da AWS nunca chega a ser carregado,
      // o que encurta o cold start.
      const { publishToAppSync } = await import("@/lib/appsync");
      await publishToAppSync(publisher, event);
    } else {
      publishLocal(event);
    }
  } catch (error) {
    console.error("Falha ao publicar o fogo", error);
    return Response.json({ error: "publish_failed" }, { status: 502 });
  }

  return Response.json({ id: event.id }, { status: 202 });
}

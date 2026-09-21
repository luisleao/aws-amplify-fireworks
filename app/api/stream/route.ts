import type { NextRequest } from "next/server";

import { getPublisherConfig } from "@/lib/config";
import { subscribeLocal } from "@/lib/local-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

/**
 * Transporte de desenvolvimento: SSE alimentado pelo barramento em memória.
 * Com o AppSync configurado o telão assina o WebSocket e esta rota sai de cena.
 */
export async function GET(request: NextRequest) {
  if (getPublisherConfig()) {
    return Response.json({ error: "appsync_configured" }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const unsubscribe = subscribeLocal((event) => send(`data: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(() => send(": ka\n\n"), HEARTBEAT_MS);

      const teardown = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Já fechado pelo cliente.
        }
      };

      request.signal.addEventListener("abort", teardown);
      send(": conectado\n\n");
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Impede buffering em proxies que esperariam o corpo terminar.
      "x-accel-buffering": "no",
    },
  });
}

import { hasAppSyncSubscriberConfig, subscriberConfig } from "./config";
import { parseFireworkEvent, type FireworkEvent } from "./fireworks";

/**
 * Assinatura do canal de fogos no navegador.
 *
 * Escolhe o transporte pela configuração: WebSocket do AppSync Events quando as
 * variáveis `NEXT_PUBLIC_EVENTS_*` estão presentes, SSE local caso contrário.
 * Reconecta sozinho com backoff e ignora eventos repetidos por id, para que uma
 * reconexão não faça o mesmo fogo estourar duas vezes no telão.
 */

export type ConnectionStatus = "connecting" | "live" | "offline";

export type SubscribeHandlers = {
  onEvent: (event: FireworkEvent) => void;
  onStatus?: (status: ConnectionStatus) => void;
};

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;
const SEEN_LIMIT = 500;

/**
 * Ids já entregues nesta página, compartilhados por todas as assinaturas.
 *
 * Fica no módulo, e não na chamada, porque pode haver mais de um transporte
 * vivo ao mesmo tempo — durante uma reconexão, ou quando o Fast Refresh
 * remonta o efeito antes de a conexão anterior morrer. Com um conjunto por
 * assinatura, um evento que chegasse pelos dois estouraria dois fogos.
 */
const seen = new Set<string>();

export function subscribeToFireworks({ onEvent, onStatus }: SubscribeHandlers): () => void {
  let stopped = false;
  let attempt = 0;
  let disconnect: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const deliver = (event: FireworkEvent) => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > SEEN_LIMIT) {
      // Set preserva ordem de inserção: descarta o mais antigo.
      seen.delete(seen.values().next().value as string);
    }
    onEvent(event);
  };

  const status = (next: ConnectionStatus) => {
    if (!stopped) onStatus?.(next);
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    status("offline");
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
    attempt += 1;
    // Jitter para não sincronizar reconexões de vários telões.
    reconnectTimer = setTimeout(connect, backoff * (0.5 + Math.random() * 0.5));
  };

  const connect = () => {
    if (stopped) return;
    status("connecting");
    const handlers = {
      onEvent: deliver,
      onLive: () => {
        attempt = 0;
        status("live");
      },
      onClosed: scheduleReconnect,
    };
    disconnect = hasAppSyncSubscriberConfig() ? connectAppSync(handlers) : connectSse(handlers);
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    disconnect?.();
  };
}

type TransportHandlers = {
  onEvent: (event: FireworkEvent) => void;
  onLive: () => void;
  onClosed: () => void;
};

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Protocolo do AppSync Events: as credenciais viajam num subprotocolo
 * `header-<base64url>` no handshake, e cada `subscribe` repete a autorização.
 */
function connectAppSync({ onEvent, onLive, onClosed }: TransportHandlers): () => void {
  const authorization = {
    host: subscriberConfig.httpDomain,
    "x-api-key": subscriberConfig.apiKey,
  };

  const socket = new WebSocket(`wss://${subscriberConfig.realtimeDomain}/event/realtime`, [
    "aws-appsync-event-ws",
    `header-${base64UrlEncode(JSON.stringify(authorization))}`,
  ]);

  const subscriptionId = crypto.randomUUID();
  let keepAliveTimer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (keepAliveTimer) clearTimeout(keepAliveTimer);
    try {
      socket.close();
    } catch {
      // Já fechando.
    }
    onClosed();
  };

  /** O servidor manda "ka" a cada 60s; sem isso a conexão está morta. */
  const armKeepAlive = (timeoutMs: number) => {
    if (keepAliveTimer) clearTimeout(keepAliveTimer);
    keepAliveTimer = setTimeout(finish, timeoutMs);
  };

  socket.onopen = () => socket.send(JSON.stringify({ type: "connection_init" }));

  socket.onmessage = (raw) => {
    const message = safeParse(raw.data);
    if (!message || typeof message !== "object") return;
    const { type } = message as { type?: string };

    switch (type) {
      case "connection_ack": {
        const { connectionTimeoutMs } = message as { connectionTimeoutMs?: number };
        armKeepAlive(connectionTimeoutMs ?? 300_000);
        socket.send(
          JSON.stringify({
            type: "subscribe",
            id: subscriptionId,
            channel: subscriberConfig.channel,
            authorization,
          }),
        );
        break;
      }
      case "subscribe_success":
        onLive();
        break;
      case "ka":
        armKeepAlive(300_000);
        break;
      case "data": {
        // O campo `event` chega como JSON já serializado, avulso ou em lista.
        const payload = (message as { event?: unknown }).event;
        for (const item of Array.isArray(payload) ? payload : [payload]) {
          if (typeof item !== "string") continue;
          const parsed = parseFireworkEvent(safeParse(item));
          if (parsed) onEvent(parsed);
        }
        break;
      }
      case "subscribe_error":
      case "connection_error":
        console.error("AppSync Events recusou a assinatura", message);
        finish();
        break;
    }
  };

  socket.onerror = finish;
  socket.onclose = finish;

  return () => {
    finished = true;
    if (keepAliveTimer) clearTimeout(keepAliveTimer);
    socket.close();
  };
}

function connectSse({ onEvent, onLive, onClosed }: TransportHandlers): () => void {
  const source = new EventSource("/api/stream");
  let finished = false;

  source.onopen = onLive;
  source.onmessage = (message) => {
    const parsed = parseFireworkEvent(safeParse(message.data));
    if (parsed) onEvent(parsed);
  };
  source.onerror = () => {
    if (finished) return;
    finished = true;
    source.close();
    onClosed();
  };

  return () => {
    finished = true;
    source.close();
  };
}

function safeParse(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

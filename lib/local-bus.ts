import type { FireworkEvent } from "./fireworks";

/**
 * Barramento em memória usado quando o AppSync não está configurado.
 *
 * Só funciona porque `next dev` e `next start` rodam um único processo: serve
 * para desenvolver e ensaiar o visual sem provisionar nada na AWS. Em produção
 * no Amplify (várias Lambdas) ele não entregaria eventos entre instâncias — é
 * exatamente o motivo de existir o AppSync Events.
 */

type Subscriber = (event: FireworkEvent) => void;

// Preso ao globalThis para sobreviver ao hot reload do `next dev`.
const globalRef = globalThis as typeof globalThis & { __fireworksBus?: Set<Subscriber> };
const subscribers: Set<Subscriber> = (globalRef.__fireworksBus ??= new Set<Subscriber>());

export function subscribeLocal(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function publishLocal(event: FireworkEvent): void {
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      // Uma conexão morta não pode derrubar o disparo das outras.
    }
  }
}

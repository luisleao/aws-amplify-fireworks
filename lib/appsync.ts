import "server-only";

import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

import type { PublisherConfig } from "./config";
import type { FireworkEvent } from "./fireworks";

/**
 * Publica um evento no endpoint HTTP da Event API, assinando com SigV4.
 *
 * Contrato do AppSync Events: POST https://<http-domain>/event com
 * `{ channel, events }`, onde cada item de `events` é um JSON já serializado
 * em string. Até 5 eventos por requisição.
 */

// Reaproveitado entre invocações quentes da Lambda — resolver credenciais a
// cada pedido adicionaria latência visível no telão.
let cachedSigner: { region: string; signer: SignatureV4 } | null = null;

function getSigner(region: string): SignatureV4 {
  if (cachedSigner?.region !== region) {
    cachedSigner = {
      region,
      signer: new SignatureV4({
        credentials: defaultProvider(),
        region,
        service: "appsync",
        sha256: Sha256,
      }),
    };
  }
  return cachedSigner.signer;
}

export async function publishToAppSync(config: PublisherConfig, event: FireworkEvent): Promise<void> {
  const body = JSON.stringify({
    channel: config.channel,
    events: [JSON.stringify(event)],
  });

  const signed = await getSigner(config.region).sign(
    new HttpRequest({
      method: "POST",
      protocol: "https:",
      hostname: config.httpDomain,
      path: "/event",
      headers: {
        "content-type": "application/json",
        host: config.httpDomain,
      },
      body,
    }),
  );

  const response = await fetch(`https://${config.httpDomain}/event`, {
    method: "POST",
    headers: signed.headers,
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`AppSync respondeu ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }

  // Um 200 ainda pode trazer eventos recusados pelo handler do namespace.
  const result = (await response.json().catch(() => null)) as { failed?: unknown[] } | null;
  if (result?.failed?.length) {
    throw new Error(`AppSync recusou o evento: ${JSON.stringify(result.failed).slice(0, 400)}`);
  }
}

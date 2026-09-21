/**
 * Configuração do transporte de eventos.
 *
 * Sem variáveis de ambiente o app roda 100% local: o Route Handler publica num
 * barramento em memória e o telão consome por SSE. Com as variáveis do AppSync
 * preenchidas, publish e subscribe passam a usar a Event API.
 */

export const DEFAULT_CHANNEL = "/default/show";

export type PublisherConfig = {
  httpDomain: string;
  region: string;
  channel: string;
};

/**
 * Lado servidor. Publicar exige IAM (SigV4), então aqui não existe API key:
 * as credenciais vêm da role de compute do Amplify em produção e do seu
 * perfil da AWS CLI em desenvolvimento.
 */
export function getPublisherConfig(): PublisherConfig | null {
  const httpDomain = process.env.EVENTS_HTTP_DOMAIN?.trim();
  if (!httpDomain) return null;
  return {
    httpDomain,
    region: process.env.EVENTS_REGION?.trim() || process.env.AWS_REGION?.trim() || "us-east-1",
    channel: process.env.EVENTS_CHANNEL?.trim() || DEFAULT_CHANNEL,
  };
}

/**
 * Lado cliente. Precisa ser lido com `process.env.NEXT_PUBLIC_*` literal para
 * o Next conseguir embutir o valor no bundle em tempo de build — por isso as
 * chaves estão escritas uma a uma em vez de acessadas dinamicamente.
 *
 * A API key aqui é pública por natureza. Ela só autoriza conectar e assinar:
 * publicar exige IAM, que o navegador não tem.
 */
export const subscriberConfig = {
  httpDomain: process.env.NEXT_PUBLIC_EVENTS_HTTP_DOMAIN ?? "",
  realtimeDomain: process.env.NEXT_PUBLIC_EVENTS_REALTIME_DOMAIN ?? "",
  apiKey: process.env.NEXT_PUBLIC_EVENTS_API_KEY ?? "",
  channel: process.env.NEXT_PUBLIC_EVENTS_CHANNEL || DEFAULT_CHANNEL,
} as const;

export function hasAppSyncSubscriberConfig(): boolean {
  return Boolean(subscriberConfig.httpDomain && subscriberConfig.realtimeDomain && subscriberConfig.apiKey);
}

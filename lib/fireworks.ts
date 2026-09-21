/**
 * Catálogo de fogos — fonte única de verdade compartilhada entre o seletor (/),
 * o telão (/screen) e a validação do backend.
 *
 * O payload aceito pelo backend é fechado de propósito: apenas ids deste
 * catálogo. Não existe texto livre nem qualquer campo de identificação, então
 * nada que um participante envia pode virar conteúdo arbitrário no telão.
 */

export const ANIMATIONS = [
  {
    id: "peony",
    label: "Peônia",
    hint: "A explosão esférica clássica",
  },
  {
    id: "chrysanthemum",
    label: "Crisântemo",
    hint: "Esfera com rastros longos",
  },
  {
    id: "willow",
    label: "Salgueiro",
    hint: "Cai devagar como uma cortina",
  },
  {
    id: "palm",
    label: "Palmeira",
    hint: "Poucos jatos grossos que arqueiam",
  },
  {
    id: "ring",
    label: "Anel",
    hint: "Um círculo perfeito no céu",
  },
  {
    id: "crackle",
    label: "Estalo",
    hint: "Mil faíscas que piscam",
  },
] as const;

export const COLORS = [
  { id: "gold", label: "Ouro", swatch: "#ffc23b", hue: 44, spread: 18 },
  { id: "red", label: "Rubi", swatch: "#ff3b4e", hue: 356, spread: 14 },
  { id: "pink", label: "Magenta", swatch: "#ff56b0", hue: 328, spread: 16 },
  { id: "purple", label: "Violeta", swatch: "#a45bff", hue: 272, spread: 22 },
  { id: "blue", label: "Safira", swatch: "#3b8cff", hue: 214, spread: 18 },
  { id: "cyan", label: "Turquesa", swatch: "#2be8e0", hue: 178, spread: 16 },
  { id: "green", label: "Esmeralda", swatch: "#47f06b", hue: 136, spread: 20 },
  {
    id: "rainbow",
    label: "Arco-íris",
    swatch: "conic-gradient(from 0deg, #ff3b4e, #ffc23b, #47f06b, #2be8e0, #3b8cff, #a45bff, #ff3b4e)",
    hue: 0,
    spread: 360,
  },
] as const;

export type Animation = (typeof ANIMATIONS)[number];
export type Color = (typeof COLORS)[number];
export type AnimationId = Animation["id"];
export type ColorId = Color["id"];

const ANIMATION_IDS = new Set<string>(ANIMATIONS.map((a) => a.id));
const COLOR_IDS = new Set<string>(COLORS.map((c) => c.id));

export const COLOR_BY_ID = Object.fromEntries(COLORS.map((c) => [c.id, c])) as Record<ColorId, Color>;

/** O que o participante escolhe. */
export type FireworkRequest = {
  animation: AnimationId;
  color: ColorId;
};

/** O que trafega até o telão. */
export type FireworkEvent = FireworkRequest & {
  /** Versão do envelope, para o telão poder ignorar formatos futuros. */
  v: 1;
  /** Id único do disparo — usado para deduplicar reconexões. */
  id: string;
  /** Epoch em ms de quando o backend aceitou o pedido. */
  at: number;
};

/**
 * Valida um corpo de requisição desconhecido. Retorna `null` para qualquer
 * coisa fora do catálogo — nunca lança.
 */
export function parseFireworkRequest(input: unknown): FireworkRequest | null {
  if (typeof input !== "object" || input === null) return null;
  const { animation, color } = input as Record<string, unknown>;
  if (typeof animation !== "string" || !ANIMATION_IDS.has(animation)) return null;
  if (typeof color !== "string" || !COLOR_IDS.has(color)) return null;
  return { animation: animation as AnimationId, color: color as ColorId };
}

/** Aceita apenas eventos no formato atual, vindos do canal. */
export function parseFireworkEvent(input: unknown): FireworkEvent | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  if (raw.v !== 1) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 64) return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return null;
  const request = parseFireworkRequest(raw);
  if (!request) return null;
  return { v: 1, id: raw.id, at: raw.at, ...request };
}

export function createFireworkEvent(request: FireworkRequest): FireworkEvent {
  return { v: 1, id: crypto.randomUUID(), at: Date.now(), ...request };
}

/**
 * Contornos paramétricos dos fogos com formato.
 *
 * Cada ponto tem módulo <= 1 e já está em coordenadas de canvas (y para
 * baixo). A explosão usa o ponto como vetor de velocidade multiplicado por uma
 * escala única, então a figura inteira expande mantendo a proporção — é isso
 * que faz uma estrela continuar lendo como estrela enquanto cresce.
 *
 * Os ícones do seletor desenham estes mesmos contornos, para o desenho no botão
 * ser literalmente o que vai aparecer no céu.
 */

export type Vec2 = { readonly x: number; readonly y: number };

const TAU = Math.PI * 2;

/**
 * Reamostra um contorno fechado em `count` pontos equidistantes ao longo do
 * perímetro. Sem isso as partículas se acumulam nos vértices (estrela) e nos
 * trechos de curvatura alta (coração), e a figura fica irregular.
 */
function resampleClosed(points: readonly Vec2[], count: number): Vec2[] {
  const segments = points.length;
  const lengths: number[] = [];
  let perimeter = 0;

  for (let i = 0; i < segments; i += 1) {
    const from = points[i];
    const to = points[(i + 1) % segments];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    lengths.push(length);
    perimeter += length;
  }

  const result: Vec2[] = [];
  let segment = 0;
  let consumed = 0;

  for (let i = 0; i < count; i += 1) {
    const target = (i / count) * perimeter;
    while (segment < segments - 1 && consumed + lengths[segment] < target) {
      consumed += lengths[segment];
      segment += 1;
    }
    const from = points[segment];
    const to = points[(segment + 1) % segments];
    const t = lengths[segment] > 0 ? (target - consumed) / lengths[segment] : 0;
    result.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }

  return result;
}

/** Escala o conjunto para que o ponto mais distante fique exatamente no raio 1. */
function normalize(points: readonly Vec2[]): Vec2[] {
  const max = points.reduce((largest, point) => Math.max(largest, Math.hypot(point.x, point.y)), 0);
  if (max === 0) return [...points];
  return points.map((point) => ({ x: point.x / max, y: point.y / max }));
}

function buildStar(tips: number, innerRatio: number, count: number): Vec2[] {
  const vertices: Vec2[] = [];
  for (let i = 0; i < tips * 2; i += 1) {
    // Começa em -90° para a ponta ficar para cima.
    const angle = -Math.PI / 2 + (i * Math.PI) / tips;
    const radius = i % 2 === 0 ? 1 : innerRatio;
    vertices.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return normalize(resampleClosed(vertices, count));
}

function buildHeart(count: number): Vec2[] {
  const samples: Vec2[] = [];
  const resolution = 720;
  for (let i = 0; i < resolution; i += 1) {
    const t = (i / resolution) * TAU;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 6 * Math.cos(3 * t) - Math.cos(4 * t);
    // Inverte o y: a curva é escrita em eixo matemático, o canvas cresce para baixo.
    samples.push({ x, y: -y });
  }
  return normalize(resampleClosed(samples, count));
}

function buildSpiral(arms: number, perArm: number, sweep: number): Vec2[] {
  const points: Vec2[] = [];
  for (let arm = 0; arm < arms; arm += 1) {
    for (let i = 0; i < perArm; i += 1) {
      const t = (i + 1) / perArm;
      const angle = (arm / arms) * TAU + t * sweep;
      // O raio cresce junto com o ângulo, então o ponto interno sai mais devagar
      // e o braço fica curvo em vez de reto.
      const radius = 0.16 + 0.84 * t;
      points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  }
  return points;
}

export const STAR_OUTLINE: readonly Vec2[] = buildStar(5, 0.44, 132);
export const HEART_OUTLINE: readonly Vec2[] = buildHeart(140);
export const SPIRAL_OUTLINE: readonly Vec2[] = buildSpiral(3, 50, 2.5);

/** Amostra `count` pontos de um contorno — usado pelos ícones do seletor. */
export function sampleOutline(outline: readonly Vec2[], count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => outline[Math.floor((i * outline.length) / count)]);
}

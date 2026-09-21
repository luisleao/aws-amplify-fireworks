import type { AnimationId } from "@/lib/fireworks";
import { HEART_OUTLINE, SPIRAL_OUTLINE, STAR_OUTLINE, sampleOutline, type Vec2 } from "@/lib/shapes";

/**
 * Ícone que desenha o formato de cada animação.
 *
 * Os fogos com figura usam o mesmo contorno que o motor usa para explodir, de
 * modo que o botão mostra literalmente o que vai aparecer no céu.
 *
 * O resto é derivado de um gerador pseudoaleatório com semente fixa: o mesmo
 * desenho sai no servidor e no cliente, sem risco de divergência na hidratação.
 */

const SIZE = 48;
const CENTER = SIZE / 2;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polar(angle: number, radius: number): [number, number] {
  return [CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius];
}

function rays(count: number, inner: number, outer: number, rotation = 0) {
  return Array.from({ length: count }, (_, i) => {
    const angle = rotation + (i / count) * Math.PI * 2;
    const [x1, y1] = polar(angle, inner);
    const [x2, y2] = polar(angle, outer);
    return { key: i, x1, y1, x2, y2 };
  });
}

/** Desenha um contorno do motor como nuvem de pontos dentro do ícone. */
function outlineDots(outline: readonly Vec2[], count: number, radius: number) {
  return sampleOutline(outline, count).map((point, i) => (
    <circle key={i} cx={CENTER + point.x * 19} cy={CENTER + point.y * 19} r={radius} fill="currentColor" stroke="none" />
  ));
}

export function FireworkGlyph({ animation }: { animation: AnimationId }) {
  const common = {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    width: "100%",
    height: "100%",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    "aria-hidden": true,
  };

  switch (animation) {
    case "peony":
      return (
        <svg {...common} strokeWidth={2}>
          {rays(12, 5, 18).map(({ key, x1, y1, x2, y2 }) => (
            <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
        </svg>
      );

    case "chrysanthemum":
      return (
        <svg {...common} strokeWidth={1.5}>
          {rays(16, 3, 21, 0.2).map(({ key, x1, y1, x2, y2 }) => (
            <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
          {rays(16, 21, 21, 0.2).map(({ key, x2, y2 }) => (
            <circle key={key} cx={x2} cy={y2} r={1.1} fill="currentColor" stroke="none" />
          ))}
        </svg>
      );

    case "willow":
      return (
        <svg {...common} strokeWidth={1.7}>
          {Array.from({ length: 7 }, (_, i) => {
            // Todas as hastes saem do mesmo ponto de explosão, abrem na
            // horizontal e tombam: é a silhueta de cúpula do salgueiro.
            const offset = (i / 6 - 0.5) * 36;
            const fall = 42 - Math.abs(offset) * 0.32;
            return (
              <path
                key={i}
                d={`M${CENTER} 12 C ${CENTER + offset * 0.55} 12, ${CENTER + offset} 19, ${CENTER + offset} ${fall}`}
              />
            );
          })}
        </svg>
      );

    case "palm":
      return (
        <svg {...common} strokeWidth={2.6}>
          {Array.from({ length: 5 }, (_, i) => {
            const angle = Math.PI + 0.3 + (i / 4) * (Math.PI - 0.6);
            const [midX, midY] = polar(angle, 13);
            const [tipX, tipY] = polar(angle, 19);
            return <path key={i} d={`M${CENTER} ${CENTER + 8} Q ${midX} ${midY} ${tipX} ${tipY + 8}`} />;
          })}
        </svg>
      );

    case "ring":
      return (
        <svg {...common} strokeWidth={1.5}>
          {rays(16, 16, 16).map(({ key, x2, y2 }) => (
            <circle key={key} cx={x2} cy={y2} r={1.9} fill="currentColor" stroke="none" />
          ))}
        </svg>
      );

    case "star":
      return <svg {...common}>{outlineDots(STAR_OUTLINE, 26, 1.5)}</svg>;

    case "heart":
      return <svg {...common}>{outlineDots(HEART_OUTLINE, 36, 1.35)}</svg>;

    case "spiral":
      return <svg {...common}>{outlineDots(SPIRAL_OUTLINE, 30, 1.4)}</svg>;

    case "crackle": {
      const random = seeded(7);
      return (
        <svg {...common} strokeWidth={1.4}>
          {rays(6, 3, 9).map(({ key, x1, y1, x2, y2 }) => (
            <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
          {Array.from({ length: 22 }, (_, i) => {
            const [x, y] = polar(random() * Math.PI * 2, 9 + random() * 11);
            return <circle key={i} cx={x} cy={y} r={0.7 + random() * 1.1} fill="currentColor" stroke="none" />;
          })}
        </svg>
      );
    }
  }
}

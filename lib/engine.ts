import { COLOR_BY_ID, type AnimationId, type ColorId } from "./fireworks";
import { HEART_OUTLINE, SPIRAL_OUTLINE, STAR_OUTLINE, type Vec2 } from "./shapes";

/**
 * Motor de fogos em canvas 2D.
 *
 * Um pedido vira um rojão que sobe soltando faíscas e, no ápice, explode
 * segundo a receita declarativa da animação escolhida (`SHELLS`). O rastro não
 * é desenhado partícula a partícula: a cada quadro o canvas inteiro perde um
 * pouco de alfa (`destination-out`), então o que foi desenhado antes esmaece
 * sozinho e o custo por quadro não depende do tamanho do rastro.
 */

const TAU = Math.PI * 2;
/** Referência de quadro: toda velocidade está em px por quadro de 60fps. */
const FRAME_MS = 1000 / 60;
const ROCKET_GRAVITY = 0.25;
const TRAIL_FADE = 0.16;
const MAX_PARTICLES = 6000;
const MAX_ROCKETS = 12;
/** Espaçamento mínimo entre lançamentos, para uma rajada virar sequência. */
const LAUNCH_INTERVAL_MS = 110;
/** Para onde a brasa caminha: laranja fosco, como pólvora queimando. */
const EMBER_HUE = 26;
const EMBER_SATURATION = 58;

type Range = readonly [number, number];

/** Como a direção de cada partícula da camada é escolhida. */
type Direction =
  | { kind: "sphere" }
  | { kind: "ring"; tilt: Range }
  | { kind: "fronds"; fronds: number; jitter: number }
  | { kind: "shape"; points: readonly Vec2[] };

/**
 * Ignição secundária: a partícula se parte em faíscas depois de um tempo de
 * voo. É o que diferencia um estalo de uma esfera qualquer — o brilho que
 * importa não nasce na explosão, nasce depois dela.
 */
type Split = {
  at: Range;
  count: number;
  speed: Range;
  life: Range;
  size: number;
  saturation: number;
  lightness: number;
  twinkleFrom: number;
};

type Layer = {
  count: number;
  direction: Direction;
  speed: Range;
  /** `area` preenche o volume; `edge` mantém as partículas na casca. */
  fill?: "area" | "edge";
  life: Range;
  size: number;
  gravity: number;
  drag: number;
  saturation?: number;
  lightness?: number;
  /** Multiplica a variação de matiz da cor escolhida. */
  hueSpread?: number;
  /** Fração da vida em que a cintilação chega ao máximo. Ausente = sem cintilar. */
  twinkleFrom?: number;
  /** Esfria para brasa alaranjada ao longo da vida. */
  ember?: boolean;
  split?: Split;
};

type Shell = {
  /** Mira mais ao centro e mais alto — figuras precisam caber inteiras na tela. */
  centered?: boolean;
  layers: readonly Layer[];
};

const SPHERE: Direction = { kind: "sphere" };

/**
 * As receitas. Ajustar um fogo é mexer em números aqui, não em código de
 * desenho — e é por isso que as camadas existem: quase todo fogo bonito é uma
 * casca externa somada a um núcleo mais lento e mais claro, que dá volume.
 */
const SHELLS: Record<AnimationId, Shell> = {
  peony: {
    layers: [
      {
        count: 112,
        direction: SPHERE,
        fill: "area",
        speed: [1.8, 5.4],
        life: [1150, 1680],
        size: 2.5,
        gravity: 0.055,
        drag: 0.962,
        twinkleFrom: 0.74,
      },
      {
        count: 34,
        direction: SPHERE,
        fill: "area",
        speed: [0.4, 1.9],
        life: [850, 1250],
        size: 3.1,
        lightness: 76,
        gravity: 0.05,
        drag: 0.955,
      },
    ],
  },

  chrysanthemum: {
    layers: [
      {
        count: 132,
        direction: SPHERE,
        // Casca oca: o crisântemo é um anel de estrelas, não uma bola cheia.
        fill: "edge",
        speed: [2.6, 5.5],
        life: [1800, 2450],
        size: 2.2,
        gravity: 0.05,
        drag: 0.984,
        ember: true,
        twinkleFrom: 0.8,
      },
    ],
  },

  willow: {
    layers: [
      {
        count: 92,
        direction: SPHERE,
        fill: "edge",
        speed: [1.3, 2.7],
        life: [2600, 3500],
        size: 2.0,
        lightness: 68,
        // Arrasto alto trava o avanço horizontal cedo; a gravidade faz o resto,
        // e o resultado é a cortina caindo reta.
        gravity: 0.092,
        drag: 0.99,
        ember: true,
        twinkleFrom: 0.84,
      },
    ],
  },

  palm: {
    layers: [
      {
        count: 144,
        direction: { kind: "fronds", fronds: 8, jitter: 0.1 },
        speed: [1.2, 4.9],
        life: [1550, 2150],
        size: 3.2,
        gravity: 0.085,
        drag: 0.982,
        ember: true,
      },
      {
        count: 28,
        direction: SPHERE,
        fill: "area",
        speed: [0.3, 1.5],
        life: [700, 1000],
        size: 2.4,
        lightness: 82,
        gravity: 0.05,
        drag: 0.95,
      },
    ],
  },

  ring: {
    layers: [
      {
        count: 104,
        // Achatamento no eixo Y sugere um anel visto de viés.
        direction: { kind: "ring", tilt: [0.34, 0.88] },
        speed: [3.95, 4.15],
        life: [1400, 1700],
        size: 2.6,
        gravity: 0.045,
        drag: 0.979,
        twinkleFrom: 0.76,
      },
    ],
  },

  star: {
    centered: true,
    layers: [
      {
        count: 132,
        direction: { kind: "shape", points: STAR_OUTLINE },
        // Faixa de velocidade estreita: qualquer dispersão borra a figura.
        speed: [4.6, 4.9],
        life: [1550, 1900],
        size: 2.6,
        // Gravidade baixa e arrasto alto: expande, trava e segura a forma.
        gravity: 0.022,
        drag: 0.987,
        hueSpread: 0.5,
        twinkleFrom: 0.72,
      },
      {
        count: 36,
        direction: SPHERE,
        fill: "area",
        speed: [0.3, 1.2],
        life: [800, 1150],
        size: 2.2,
        lightness: 82,
        gravity: 0.03,
        drag: 0.95,
      },
    ],
  },

  heart: {
    centered: true,
    layers: [
      {
        count: 140,
        direction: { kind: "shape", points: HEART_OUTLINE },
        speed: [4.4, 4.7],
        life: [1650, 2050],
        size: 2.7,
        gravity: 0.02,
        drag: 0.988,
        hueSpread: 0.5,
        twinkleFrom: 0.74,
      },
      {
        count: 30,
        direction: SPHERE,
        fill: "area",
        speed: [0.25, 1.0],
        life: [850, 1200],
        size: 2.2,
        lightness: 82,
        gravity: 0.03,
        drag: 0.95,
      },
    ],
  },

  spiral: {
    centered: true,
    layers: [
      {
        count: 150,
        direction: { kind: "shape", points: SPIRAL_OUTLINE },
        speed: [4.4, 4.9],
        life: [1450, 1850],
        size: 2.3,
        gravity: 0.03,
        drag: 0.984,
        twinkleFrom: 0.72,
      },
    ],
  },

  crackle: {
    // Abertura contida de propósito: o espetáculo não é a explosão, é o
    // chiado que vem depois dela.
    layers: [
      {
        count: 28,
        direction: SPHERE,
        fill: "area",
        speed: [1.0, 3.2],
        life: [380, 580],
        size: 2.1,
        lightness: 72,
        gravity: 0.03,
        drag: 0.96,
        split: {
          at: [190, 380],
          count: 9,
          speed: [0.6, 2.6],
          life: [430, 780],
          size: 1.3,
          // Faíscas quase prateadas, com só um resto da cor escolhida.
          saturation: 38,
          lightness: 92,
          twinkleFrom: 0,
        },
      },
      {
        count: 32,
        direction: SPHERE,
        fill: "edge",
        speed: [3.0, 6.0],
        life: [450, 700],
        size: 1.9,
        lightness: 70,
        gravity: 0.035,
        drag: 0.965,
        split: {
          at: [270, 520],
          count: 7,
          speed: [0.5, 2.4],
          life: [380, 720],
          size: 1.2,
          saturation: 38,
          lightness: 92,
          twinkleFrom: 0,
        },
      },
    ],
  },
};

type Particle = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  hue: number;
  saturation: number;
  lightness: number;
  size: number;
  gravity: number;
  drag: number;
  ember: boolean;
  /** Fração da vida em que a cintilação chega ao máximo; >= 2 nunca cintila. */
  twinkleFrom: number;
  twinkleRate: number;
  twinklePhase: number;
  /** Idade em ms na qual a partícula se parte; Infinity = não se parte. */
  splitAt: number;
  split: Split | null;
};

type Rocket = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  targetY: number;
  hue: number;
  spread: number;
  animation: AnimationId;
};

export type LaunchRequest = { animation: AnimationId; color: ColorId };

export class FireworksEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private rockets: Rocket[] = [];
  private queue: LaunchRequest[] = [];
  private width = 0;
  private height = 0;
  private frame: number | null = null;
  private lastFrameAt = 0;
  private lastLaunchAt = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas 2D indisponível neste navegador");
    this.canvas = canvas;
    this.context = context;
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }

  /** Enfileira um disparo. A fila é drenada no ritmo de `LAUNCH_INTERVAL_MS`. */
  launch(request: LaunchRequest): void {
    // Em caso de enxurrada, prefira os pedidos mais recentes a acumular atraso.
    if (this.queue.length > 60) this.queue.shift();
    this.queue.push(request);
  }

  start(): void {
    if (this.frame !== null) return;
    this.lastFrameAt = performance.now();
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick);
      // Um limite evita que a aba voltando do background entregue um dt enorme
      // e teletransporte todas as partículas.
      const dt = Math.min(now - this.lastFrameAt, 48);
      this.lastFrameAt = now;
      this.update(dt, now);
      this.draw(dt);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  destroy(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.particles = [];
    this.rockets = [];
    this.queue = [];
  }

  private resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private update(dt: number, now: number): void {
    const step = dt / FRAME_MS;

    if (this.queue.length > 0 && now - this.lastLaunchAt >= LAUNCH_INTERVAL_MS && this.rockets.length < MAX_ROCKETS) {
      this.lastLaunchAt = now;
      this.spawnRocket(this.queue.shift()!);
    }

    for (let i = this.rockets.length - 1; i >= 0; i -= 1) {
      const rocket = this.rockets[i];
      rocket.px = rocket.x;
      rocket.py = rocket.y;
      rocket.x += rocket.vx * step;
      rocket.y += rocket.vy * step;
      rocket.vy += ROCKET_GRAVITY * step;
      this.shedRocketSpark(rocket, step);

      if (rocket.vy >= -1.2 || rocket.y <= rocket.targetY) {
        this.explode(rocket);
        this.rockets.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      particle.age += dt;
      if (particle.age >= particle.life) {
        this.particles.splice(i, 1);
        continue;
      }
      if (particle.age >= particle.splitAt) {
        this.splitParticle(particle);
        particle.splitAt = Infinity;
      }
      particle.px = particle.x;
      particle.py = particle.y;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vy += particle.gravity * step;
      const drag = particle.drag ** step;
      particle.vx *= drag;
      particle.vy *= drag;
    }
  }

  private draw(dt: number): void {
    const ctx = this.context;

    // Esmaece o quadro anterior em vez de limpá-lo: é isso que vira rastro.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, TRAIL_FADE * (dt / FRAME_MS))})`;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    for (const rocket of this.rockets) {
      ctx.strokeStyle = `hsla(${rocket.hue}, 90%, 80%, 0.92)`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(rocket.px, rocket.py);
      ctx.lineTo(rocket.x, rocket.y);
      ctx.stroke();
    }

    for (const particle of this.particles) {
      const progress = particle.age / particle.life;
      // Queda cúbica: a partícula brilha quase toda a vida e some de vez no fim.
      const remaining = 1 - progress;
      let alpha = remaining * remaining * remaining;

      if (particle.twinkleFrom < 2) {
        // A cintilação entra ao longo de 25% da vida antes do ponto marcado,
        // então `twinkleFrom: 0` já nasce estalando.
        const ramp = clamp01((progress - particle.twinkleFrom + 0.25) / 0.25);
        const strobe = 0.5 + 0.5 * Math.sin(particle.age * particle.twinkleRate + particle.twinklePhase);
        alpha *= 1 - ramp * 0.9 * (1 - strobe);
      }
      if (alpha <= 0.012) continue;

      let hue = particle.hue;
      let saturation = particle.saturation;
      if (particle.ember) {
        const cooled = progress * 0.85;
        hue += shortestHueDelta(particle.hue, EMBER_HUE) * cooled;
        saturation += (EMBER_SATURATION - saturation) * cooled;
      }

      // O núcleo nasce branco e assume a cor conforme esfria.
      const youth = Math.max(0, 1 - particle.age / 240);
      const lightness = particle.lightness + youth * (97 - particle.lightness);

      ctx.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
      ctx.lineWidth = particle.size * (0.45 + remaining * 0.55);
      ctx.beginPath();
      ctx.moveTo(particle.px, particle.py);
      ctx.lineTo(particle.x, particle.y);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
  }

  private spawnRocket(request: LaunchRequest): void {
    const color = COLOR_BY_ID[request.color];
    const shell = SHELLS[request.animation];
    // Figuras precisam caber inteiras e não podem estourar rente à borda.
    const horizontalSpread = shell.centered ? 0.36 : 0.76;
    const x = this.width * ((1 - horizontalSpread) / 2 + Math.random() * horizontalSpread);
    const targetY = this.height * (shell.centered ? 0.16 + Math.random() * 0.16 : 0.12 + Math.random() * 0.34);

    this.rockets.push({
      x,
      y: this.height + 8,
      px: x,
      py: this.height + 8,
      vx: (Math.random() - 0.5) * 1.2,
      // Velocidade exata para a subida morrer na altura escolhida.
      vy: -Math.sqrt(2 * ROCKET_GRAVITY * (this.height - targetY)),
      targetY,
      hue: color.hue,
      spread: color.spread,
      animation: request.animation,
    });
  }

  /** Faíscas que caem do rojão durante a subida. */
  private shedRocketSpark(rocket: Rocket, step: number): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    if (Math.random() > 0.55 * step) return;

    this.particles.push(
      makeParticle({
        x: rocket.x,
        y: rocket.y,
        // Sai para trás do rojão, com uma sobra de energia para os lados.
        vx: -rocket.vx * 0.12 + (Math.random() - 0.5) * 0.55,
        vy: -rocket.vy * 0.06 + (Math.random() - 0.5) * 0.55,
        life: 260 + Math.random() * 280,
        hue: rocket.hue,
        saturation: 62,
        lightness: 84,
        size: 1.5,
        gravity: 0.02,
        drag: 0.93,
        ember: true,
      }),
    );
  }

  private explode(rocket: Rocket): void {
    for (const layer of SHELLS[rocket.animation].layers) this.emitLayer(layer, rocket);
  }

  private emitLayer(layer: Layer, rocket: Rocket): void {
    // Orçamento verificado por camada, não por partícula: truncar no meio
    // deixaria meia estrela ou meio coração no céu.
    if (this.particles.length + layer.count > MAX_PARTICLES) return;

    const rotation = Math.random() * TAU;
    const tilt = layer.direction.kind === "ring" ? pick(layer.direction.tilt) : 1;
    const fronds = layer.direction.kind === "fronds" ? layer.direction.fronds : 1;
    const perFrond = Math.max(1, Math.round(layer.count / fronds));
    const hueSpread = rocket.spread * (layer.hueSpread ?? 1);

    for (let i = 0; i < layer.count; i += 1) {
      let dx: number;
      let dy: number;
      let speed: number;

      switch (layer.direction.kind) {
        case "ring": {
          const angle = rotation + (i / layer.count) * TAU;
          dx = Math.cos(angle);
          dy = Math.sin(angle) * tilt;
          speed = pick(layer.speed);
          break;
        }
        case "fronds": {
          const frond = Math.floor(i / perFrond);
          const along = (i % perFrond) / perFrond;
          const angle = rotation + (frond / fronds) * TAU + (Math.random() - 0.5) * layer.direction.jitter;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          // A velocidade cresce ao longo do jato, o que o desenha como um
          // traço contínuo em vez de um punhado de pontos soltos.
          speed = layer.speed[0] + (layer.speed[1] - layer.speed[0]) * along;
          break;
        }
        case "shape": {
          // O ponto já carrega a figura; a escala única preserva a proporção.
          const point = layer.direction.points[i % layer.direction.points.length];
          const jitter = 1 + (Math.random() - 0.5) * 0.06;
          dx = point.x * jitter;
          dy = point.y * jitter;
          speed = pick(layer.speed);
          break;
        }
        default: {
          const angle = Math.random() * TAU;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          // Raiz quadrada distribui por área, não por raio — sem isso o centro
          // da esfera fica empapado e a borda vazia.
          speed =
            layer.fill === "edge"
              ? pick(layer.speed)
              : layer.speed[0] + (layer.speed[1] - layer.speed[0]) * Math.sqrt(Math.random());
          break;
        }
      }

      this.particles.push(
        makeParticle({
          x: rocket.x,
          y: rocket.y,
          vx: dx * speed,
          vy: dy * speed,
          life: pick(layer.life),
          hue: wrapHue(rocket.hue + (Math.random() - 0.5) * hueSpread),
          saturation: layer.saturation ?? 100,
          lightness: layer.lightness ?? 64,
          size: layer.size,
          gravity: layer.gravity,
          drag: layer.drag,
          ember: layer.ember ?? false,
          twinkleFrom: layer.twinkleFrom,
          splitAt: layer.split ? pick(layer.split.at) : Infinity,
          split: layer.split ?? null,
        }),
      );
    }
  }

  /** Ignição secundária: a partícula vira um punhado de faíscas. */
  private splitParticle(parent: Particle): void {
    const split = parent.split;
    if (!split) return;
    if (this.particles.length + split.count > MAX_PARTICLES) return;

    for (let i = 0; i < split.count; i += 1) {
      const angle = Math.random() * TAU;
      const speed = pick(split.speed);
      this.particles.push(
        makeParticle({
          x: parent.x,
          y: parent.y,
          // Herda parte do impulso do pai, senão as faíscas nascem paradas
          // e o estalo parece um borrifo em vez de uma dispersão.
          vx: parent.vx * 0.35 + Math.cos(angle) * speed,
          vy: parent.vy * 0.35 + Math.sin(angle) * speed,
          life: pick(split.life),
          hue: parent.hue,
          saturation: split.saturation,
          lightness: split.lightness,
          size: split.size,
          gravity: 0.03,
          drag: 0.9,
          twinkleFrom: split.twinkleFrom,
        }),
      );
    }
  }
}

type ParticleSeed = Omit<
  Particle,
  "px" | "py" | "age" | "ember" | "twinkleFrom" | "twinkleRate" | "twinklePhase" | "splitAt" | "split"
> &
  Partial<Pick<Particle, "ember" | "splitAt" | "split">> & { twinkleFrom?: number };

function makeParticle(seed: ParticleSeed): Particle {
  return {
    ...seed,
    px: seed.x,
    py: seed.y,
    age: 0,
    ember: seed.ember ?? false,
    // 2 está fora do intervalo de progresso (0..1), então nunca cintila.
    twinkleFrom: seed.twinkleFrom ?? 2,
    // Cada partícula pisca no seu próprio ritmo e fase: em uníssono o efeito
    // vira um piscar da tela inteira.
    twinkleRate: 0.024 + Math.random() * 0.03,
    twinklePhase: Math.random() * TAU,
    splitAt: seed.splitAt ?? Infinity,
    split: seed.split ?? null,
  };
}

function pick(range: Range): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function wrapHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

/** Caminho mais curto entre dois matizes na roda de cores, em graus. */
function shortestHueDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

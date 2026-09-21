import { COLOR_BY_ID, type AnimationId, type ColorId } from "./fireworks";

/**
 * Motor de fogos em canvas 2D.
 *
 * Um pedido vira um rojão que sobe, e no ápice explode num arranjo de
 * partículas definido pela animação escolhida. O rastro não é desenhado
 * partícula a partícula: a cada quadro o canvas inteiro perde um pouco de alfa
 * (`destination-out`), o que deixa o que foi desenhado antes esmaecendo sozinho
 * e mantém o custo por quadro constante.
 */

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
  light: number;
  size: number;
  gravity: number;
  drag: number;
  flicker: boolean;
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

type Flash = {
  x: number;
  y: number;
  age: number;
  life: number;
  hue: number;
  radius: number;
};

export type LaunchRequest = { animation: AnimationId; color: ColorId };

/** Referência de quadro: toda velocidade está em px por quadro de 60fps. */
const FRAME_MS = 1000 / 60;
const ROCKET_GRAVITY = 0.25;
const TRAIL_FADE = 0.16;
const MAX_PARTICLES = 5000;
const MAX_ROCKETS = 14;
/** Espaçamento mínimo entre lançamentos, para uma rajada virar sequência. */
const LAUNCH_INTERVAL_MS = 110;

export class FireworksEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private rockets: Rocket[] = [];
  private flashes: Flash[] = [];
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
    this.flashes = [];
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
      particle.px = particle.x;
      particle.py = particle.y;
      particle.x += particle.vx * step;
      particle.y += particle.vy * step;
      particle.vy += particle.gravity * step;
      const drag = particle.drag ** step;
      particle.vx *= drag;
      particle.vy *= drag;
    }

    for (let i = this.flashes.length - 1; i >= 0; i -= 1) {
      const flash = this.flashes[i];
      flash.age += dt;
      if (flash.age >= flash.life) this.flashes.splice(i, 1);
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

    for (const flash of this.flashes) {
      const remaining = 1 - flash.age / flash.life;
      const radius = flash.radius * (1.4 - remaining * 0.4);
      const gradient = ctx.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, radius);
      gradient.addColorStop(0, `hsla(${flash.hue}, 100%, 82%, ${0.42 * remaining})`);
      gradient.addColorStop(1, `hsla(${flash.hue}, 100%, 60%, 0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(flash.x, flash.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const rocket of this.rockets) {
      ctx.strokeStyle = `hsla(${rocket.hue}, 90%, 78%, 0.9)`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(rocket.px, rocket.py);
      ctx.lineTo(rocket.x, rocket.y);
      ctx.stroke();
    }

    for (const particle of this.particles) {
      const remaining = 1 - particle.age / particle.life;
      // Queda cúbica: a partícula brilha quase toda a vida e some de vez no fim.
      let alpha = remaining * remaining * remaining;
      if (particle.flicker) alpha *= 0.35 + Math.random() * 0.65;
      if (alpha <= 0.01) continue;

      // O núcleo nasce branco e assume a cor conforme esfria.
      const youth = Math.max(0, 1 - particle.age / 260);
      const light = particle.light + youth * (96 - particle.light);

      ctx.strokeStyle = `hsla(${particle.hue}, 100%, ${light}%, ${alpha})`;
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
    const x = this.width * (0.12 + Math.random() * 0.76);
    const targetY = this.height * (0.12 + Math.random() * 0.34);
    const climb = this.height - targetY;

    this.rockets.push({
      x,
      y: this.height + 8,
      px: x,
      py: this.height + 8,
      vx: (Math.random() - 0.5) * 1.2,
      // Velocidade exata para a subida morrer na altura escolhida.
      vy: -Math.sqrt(2 * ROCKET_GRAVITY * climb),
      targetY,
      hue: color.hue,
      spread: color.spread,
      animation: request.animation,
    });
  }

  private explode(rocket: Rocket): void {
    const { x, y, animation, hue, spread } = rocket;
    const pick = () => wrapHue(hue + (Math.random() - 0.5) * spread);

    this.flashes.push({ x, y, age: 0, life: 260, hue, radius: 90 });

    const add = (particle: Omit<Particle, "px" | "py" | "age">) => {
      if (this.particles.length >= MAX_PARTICLES) return;
      this.particles.push({ ...particle, px: particle.x, py: particle.y, age: 0 });
    };

    switch (animation) {
      case "peony": {
        for (let i = 0; i < 96; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          // Raiz quadrada distribui as partículas por área, não por raio —
          // sem isso a esfera fica com o centro empapado.
          const speed = 1.6 + Math.sqrt(Math.random()) * 3.9;
          add({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1100 + Math.random() * 500,
            hue: pick(), light: 62, size: 2.4,
            gravity: 0.055, drag: 0.964, flicker: false,
          });
        }
        break;
      }
      case "chrysanthemum": {
        for (let i = 0; i < 118; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 2.2 + Math.sqrt(Math.random()) * 3.8;
          add({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1700 + Math.random() * 600,
            hue: pick(), light: 64, size: 2.1,
            // Pouco arrasto é o que estica o rastro característico.
            gravity: 0.05, drag: 0.982, flicker: false,
          });
        }
        break;
      }
      case "willow": {
        for (let i = 0; i < 78; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.1 + Math.sqrt(Math.random()) * 2.3;
          add({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 2500 + Math.random() * 900,
            hue: pick(), light: 66, size: 1.9,
            // Gravidade alta com arrasto alto: sobe pouco e desce em cortina.
            gravity: 0.088, drag: 0.988, flicker: false,
          });
        }
        break;
      }
      case "palm": {
        const fronds = 9;
        const rotation = Math.random() * Math.PI * 2;
        for (let f = 0; f < fronds; f += 1) {
          const angle = rotation + (f / fronds) * Math.PI * 2;
          const frondHue = pick();
          for (let i = 0; i < 16; i += 1) {
            const speed = 1.3 + (i / 16) * 4.4;
            const wobble = (Math.random() - 0.5) * 0.09;
            add({
              x, y,
              vx: Math.cos(angle + wobble) * speed,
              vy: Math.sin(angle + wobble) * speed,
              life: 1500 + Math.random() * 700,
              hue: frondHue, light: 66, size: 3.1,
              gravity: 0.082, drag: 0.981, flicker: false,
            });
          }
        }
        break;
      }
      case "ring": {
        const count = 92;
        const rotation = Math.random() * Math.PI * 2;
        // Achatamento no eixo Y sugere um anel visto de viés.
        const tilt = 0.45 + Math.random() * 0.4;
        for (let i = 0; i < count; i += 1) {
          const angle = rotation + (i / count) * Math.PI * 2;
          const speed = 3.9 + (Math.random() - 0.5) * 0.45;
          add({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed * tilt,
            life: 1300 + Math.random() * 400,
            hue: pick(), light: 66, size: 2.5,
            gravity: 0.046, drag: 0.976, flicker: false,
          });
        }
        break;
      }
      case "crackle": {
        for (let i = 0; i < 56; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.4 + Math.sqrt(Math.random()) * 3.2;
          add({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 800 + Math.random() * 400,
            hue: pick(), light: 68, size: 2.2,
            gravity: 0.06, drag: 0.95, flicker: false,
          });
        }
        for (let i = 0; i < 170; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 0.8 + Math.sqrt(Math.random()) * 4.6;
          add({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 600 + Math.random() * 700,
            hue: pick(), light: 86, size: 1.2,
            gravity: 0.038, drag: 0.94, flicker: true,
          });
        }
        break;
      }
    }
  }
}

function wrapHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FireworkGlyph } from "@/components/FireworkGlyph";
import { ANIMATIONS, COLORS, type AnimationId, type ColorId } from "@/lib/fireworks";

import styles from "./page.module.css";

/** Espelha o refil do balde no servidor, para o botão travar antes do 429. */
const COOLDOWN_MS = 3000;

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export default function ChooserPage() {
  const [animation, setAnimation] = useState<AnimationId>("peony");
  const [color, setColor] = useState<ColorId>("gold");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Relógio que só corre enquanto há contagem regressiva na tela.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const interval = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const remainingMs = Math.max(0, cooldownUntil - now);
  const cooling = remainingMs > 0;
  const sending = status.kind === "sending";

  const scheduleReset = () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus({ kind: "idle" }), 2200);
  };

  const startCooldown = (durationMs: number) => {
    setNow(Date.now());
    setCooldownUntil(Date.now() + durationMs);
  };

  async function launch() {
    if (sending || cooling) return;
    setStatus({ kind: "sending" });

    try {
      const response = await fetch("/api/fireworks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ animation, color }),
      });

      if (response.status === 429) {
        const data = (await response.json().catch(() => null)) as { retryAfterMs?: number } | null;
        startCooldown(typeof data?.retryAfterMs === "number" ? data.retryAfterMs : COOLDOWN_MS);
        setStatus({ kind: "error", message: "Calma aí — espere o próximo." });
        scheduleReset();
        return;
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      navigator.vibrate?.(28);
      startCooldown(COOLDOWN_MS);
      setStatus({ kind: "sent" });
      scheduleReset();
    } catch {
      setStatus({ kind: "error", message: "Não consegui enviar. Tente de novo." });
      scheduleReset();
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Solte um fogo</h1>
        <p className={styles.subtitle}>Escolha o formato e a cor. Ele estoura no telão.</p>
      </header>

      <section className={styles.section} aria-labelledby="animacao">
        <h2 className={styles.legend} id="animacao">
          Formato
        </h2>
        <div className={styles.animationGrid} role="radiogroup" aria-labelledby="animacao">
          {ANIMATIONS.map((option) => (
            <label key={option.id} className={styles.animationOption}>
              <input
                type="radio"
                name="animation"
                value={option.id}
                checked={animation === option.id}
                onChange={() => setAnimation(option.id)}
                className={styles.visuallyHidden}
              />
              <span className={styles.glyph}>
                <FireworkGlyph animation={option.id} />
              </span>
              <span className={styles.optionLabel}>{option.label}</span>
              <span className={styles.optionHint}>{option.hint}</span>
            </label>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="cor">
        <h2 className={styles.legend} id="cor">
          Cor
        </h2>
        <div className={styles.colorGrid} role="radiogroup" aria-labelledby="cor">
          {COLORS.map((option) => (
            <label key={option.id} className={styles.colorOption} title={option.label}>
              <input
                type="radio"
                name="color"
                value={option.id}
                checked={color === option.id}
                onChange={() => setColor(option.id)}
                className={styles.visuallyHidden}
              />
              <span className={styles.swatch} style={{ background: option.swatch }} />
              <span className={styles.swatchLabel}>{option.label}</span>
            </label>
          ))}
        </div>
      </section>

      <div className={styles.launchBar}>
        <p className={styles.status} role="status" aria-live="polite">
          {status.kind === "sent" && <span className={styles.statusOk}>Lá vai! Olhe para o telão.</span>}
          {status.kind === "error" && <span className={styles.statusError}>{status.message}</span>}
          {status.kind === "idle" && cooling && <span>Pronto em {(remainingMs / 1000).toFixed(1)}s</span>}
          {status.kind === "idle" && !cooling && <span>&nbsp;</span>}
          {status.kind === "sending" && <span>Enviando…</span>}
        </p>
        <button type="button" className={styles.launchButton} onClick={launch} disabled={sending || cooling}>
          {cooling ? `Aguarde ${Math.ceil(remainingMs / 1000)}s` : "Soltar fogo"}
        </button>
      </div>

      <footer className={styles.footer}>
        <Link href="/screen" className={styles.screenLink} prefetch={false}>
          Abrir o telão →
        </Link>
      </footer>
    </main>
  );
}

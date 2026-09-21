"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { subscribeToFireworks, type ConnectionStatus } from "@/lib/event-client";
import { FireworksEngine } from "@/lib/engine";

import styles from "./screen.module.css";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "conectando",
  live: "ao vivo",
  offline: "reconectando",
};

/** A origem nunca muda durante a vida da página, então não há o que assinar. */
const subscribeToNothing = () => () => {};

/**
 * O telão. Fica aberto num projetor a noite inteira, então evita tudo que
 * dependa de interação: reconecta sozinho, segura o wake lock e não acumula
 * estado que cresça sem limite.
 */
export default function ScreenPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [count, setCount] = useState(0);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState("");

  // O link de participação sai da própria origem: serve em localhost, em
  // preview de PR e no domínio final sem nenhuma configuração. Lido por
  // useSyncExternalStore porque a página é pré-renderizada e `window` só
  // existe no cliente.
  const joinUrl = useSyncExternalStore(
    subscribeToNothing,
    () => `${window.location.origin}/`,
    () => "",
  );

  // Motor + assinatura do canal: um único efeito, montado uma vez.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new FireworksEngine(canvas);
    engine.start();

    const unsubscribe = subscribeToFireworks({
      onEvent: (event) => {
        engine.launch({ animation: event.animation, color: event.color });
        setCount((current) => current + 1);
      },
      onStatus: setStatus,
    });

    return () => {
      unsubscribe();
      engine.destroy();
    };
  }, []);

  useEffect(() => {
    if (!joinUrl) return;

    let cancelled = false;
    import("qrcode")
      .then((module) =>
        module.default.toDataURL(joinUrl, {
          margin: 1,
          width: 320,
          color: { dark: "#0a0d1f", light: "#ffffff" },
        }),
      )
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        // Sem QR o telão continua útil: a URL em texto fica logo abaixo.
      });

    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  // Mantém o projetor acordado enquanto a aba estiver visível.
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      if (released || document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // O navegador pode recusar (bateria, permissão) — não é fatal.
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", acquire);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => {});
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "h" || event.key === "H") setOverlayVisible((visible) => !visible);
      if (event.key === "f" || event.key === "F") toggleFullscreen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleFullscreen]);

  return (
    <div className={styles.stage}>
      <canvas ref={canvasRef} className={styles.canvas} />

      <div className={`${styles.overlay} ${overlayVisible ? "" : styles.overlayHidden}`}>
        <div className={styles.topBar}>
          <h1 className={styles.brand}>Céu compartilhado</h1>
          <div className={styles.meta}>
            <span className={styles.counter}>
              {count} {count === 1 ? "fogo" : "fogos"}
            </span>
            <span className={`${styles.status} ${styles[status]}`}>
              <span className={styles.dot} aria-hidden />
              {STATUS_LABEL[status]}
            </span>
          </div>
        </div>

        <div className={styles.invite}>
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL gerada no cliente
            <img src={qrDataUrl} alt="QR code para abrir o seletor de fogos" className={styles.qr} width={320} height={320} />
          ) : (
            <div className={styles.qrPlaceholder} aria-hidden />
          )}
          <div className={styles.inviteText}>
            <p className={styles.inviteTitle}>Aponte a câmera</p>
            <p className={styles.inviteUrl}>{joinUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</p>
          </div>
        </div>

        <p className={styles.hint}>
          <kbd>F</kbd> tela cheia · <kbd>H</kbd> esconder
        </p>
      </div>

      {count === 0 && status === "live" && (
        <p className={styles.idle}>Esperando o primeiro fogo…</p>
      )}
    </div>
  );
}

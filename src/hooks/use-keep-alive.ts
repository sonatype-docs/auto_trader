// Prevents the browser from throttling / suspending long-running work when
// the tab is backgrounded or the screen locks.
//
// Two mechanisms, both harmless if unsupported:
//   1) Screen Wake Lock API — keeps mobile screens on while running.
//   2) Silent looping <audio> — Chrome/Safari don't throttle timers in tabs
//      that are actively producing audio. This is the reliable way to keep
//      `setInterval`/`setTimeout` and fetch loops firing in a background tab.
//
// Also warns the user with beforeunload while active so they don't close
// the tab mid-run by accident.
import { useEffect, useRef } from "react";

// 1-second silent WAV (mono, 8kHz). Small enough to inline as a data URL.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export function useKeepAlive(active: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;

    // Silent-audio trick — must be created + played after a user gesture.
    // The Run button click is a gesture, so this is fine when triggered
    // from the pipeline's Run flow.
    let cancelled = false;
    const audio = new Audio(SILENT_WAV);
    audio.loop = true;
    audio.volume = 0.0001; // effectively silent but non-zero (Safari)
    audio.preload = "auto";
    audioRef.current = audio;
    audio.play().catch(() => {
      // Autoplay may still be blocked; the wake-lock alone is a fallback.
    });

    // Screen wake lock (mobile/desktop with support).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (nav?.wakeLock?.request) {
      nav.wakeLock.request("screen").then((lock: unknown) => {
        if (cancelled) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lock as any)?.release?.();
          return;
        }
        wakeLockRef.current = lock;
      }).catch(() => {});
    }

    // Re-acquire wake lock after tab becomes visible again.
    const onVis = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current && nav?.wakeLock?.request) {
        nav.wakeLock.request("screen").then((lock: unknown) => {
          if (!cancelled) wakeLockRef.current = lock;
        }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Pipeline is running — leaving will stop it.";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onBeforeUnload);
      try { audio.pause(); } catch { /* noop */ }
      audioRef.current = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (wakeLockRef.current as any)?.release?.();
      } catch { /* noop */ }
      wakeLockRef.current = null;
    };
  }, [active]);
}

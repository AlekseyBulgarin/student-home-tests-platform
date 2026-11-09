import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api } from "@/lib/api";

type EventType = "fullscreen_enter" | "fullscreen_exit" | "visibility_visible" | "visibility_hidden" | "window_focus" | "window_blur" | "copy_attempt" | "online" | "offline";
type PendingEvent = { event_id: string; sequence: number; type: EventType; client_occurred_at: string; payload: Record<string, never> };

export function useAttemptMonitoring({
  active,
  attemptId,
  sessionToken,
  initialSequence,
  questionAreaRef,
  onFullscreenExit,
}: {
  active: boolean;
  attemptId: string;
  sessionToken: string;
  initialSequence: number;
  questionAreaRef: RefObject<HTMLElement | null>;
  onFullscreenExit: () => void;
}) {
  const [deliveryError, setDeliveryError] = useState(false);
  const queueRef = useRef<PendingEvent[]>([]);
  const sequenceRef = useRef(initialSequence);
  const runningRef = useRef<Promise<void> | null>(null);
  const onFullscreenExitRef = useRef(onFullscreenExit);
  onFullscreenExitRef.current = onFullscreenExit;

  const flush = useCallback(async () => {
    if (!active || !navigator.onLine || !queueRef.current.length) return runningRef.current ?? undefined;
    if (runningRef.current) return runningRef.current;
    const operation = (async () => {
      while (navigator.onLine && queueRef.current.length) {
        const batch = queueRef.current.splice(0, 50);
        try {
          await api("student.events", { session_token: sessionToken, events: batch });
          setDeliveryError(false);
        } catch {
          queueRef.current = [...batch, ...queueRef.current].slice(0, 100);
          setDeliveryError(true);
          break;
        }
      }
    })();
    runningRef.current = operation;
    try { await operation; } finally { runningRef.current = null; }
  }, [active, sessionToken]);

  useEffect(() => {
    sequenceRef.current = Math.max(sequenceRef.current, initialSequence);
  }, [initialSequence]);

  useEffect(() => {
    if (!active || !attemptId) return;
    const enqueue = (type: EventType) => {
      sequenceRef.current += 1;
      queueRef.current.push({ event_id: crypto.randomUUID(), sequence: sequenceRef.current, type, client_occurred_at: new Date().toISOString(), payload: {} });
      if (queueRef.current.length >= 5) void flush();
    };
    const fullscreen = () => { const entered = Boolean(document.fullscreenElement); enqueue(entered ? "fullscreen_enter" : "fullscreen_exit"); if (!entered) onFullscreenExitRef.current(); };
    const visibility = () => { enqueue(document.visibilityState === "hidden" ? "visibility_hidden" : "visibility_visible"); if (document.visibilityState === "hidden") void flush(); };
    const focus = () => enqueue("window_focus"); const blur = () => enqueue("window_blur");
    const online = () => { enqueue("online"); void flush(); }; const offline = () => enqueue("offline");
    const copy = () => enqueue("copy_attempt");
    const questionArea = questionAreaRef.current;
    document.addEventListener("fullscreenchange", fullscreen); document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus); window.addEventListener("blur", blur); window.addEventListener("online", online); window.addEventListener("offline", offline);
    questionArea?.addEventListener("copy", copy);
    if (document.fullscreenElement) enqueue("fullscreen_enter");
    const timer = window.setInterval(() => { void flush(); }, 3000);
    return () => {
      window.clearInterval(timer); document.removeEventListener("fullscreenchange", fullscreen); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus); window.removeEventListener("blur", blur); window.removeEventListener("online", online); window.removeEventListener("offline", offline);
      questionArea?.removeEventListener("copy", copy); void flush();
    };
  }, [active, attemptId, flush, questionAreaRef]);

  return { deliveryError, flushEvents: flush };
}

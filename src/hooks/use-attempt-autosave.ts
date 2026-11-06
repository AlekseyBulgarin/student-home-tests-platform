import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { serializeAnswers } from "@/lib/attempt-reliability";

export type SaveStatus = "saved" | "saving" | "offline" | "error" | "conflict";

type SaveResponse = { accepted: boolean; revision: number; saved_at: string };

export function useAttemptAutosave({
  attemptId,
  sessionToken,
  initialRevision,
  answers,
  enabled,
  onRevision,
}: {
  attemptId: string;
  sessionToken: string;
  initialRevision: number;
  answers: Record<string, string[]>;
  enabled: boolean;
  onRevision: (revision: number) => void;
}) {
  const [status, setStatus] = useState<SaveStatus>(navigator.onLine ? "saved" : "offline");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [multipleTabs, setMultipleTabs] = useState(false);
  const answersRef = useRef(answers);
  const savedSnapshotRef = useRef(serializeAnswers(answers));
  const revisionRef = useRef(initialRevision);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const runningRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef(crypto.randomUUID());
  answersRef.current = answers;

  useEffect(() => {
    revisionRef.current = initialRevision;
    savedSnapshotRef.current = serializeAnswers(answersRef.current);
    dirtyRef.current = false;
    conflictRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setStatus(navigator.onLine ? "saved" : "offline");
  }, [attemptId]);

  useEffect(() => {
    const snapshot = serializeAnswers(answers);
    if (!enabled || snapshot === savedSnapshotRef.current) return;
    dirtyRef.current = true;
    setStatus(navigator.onLine ? "saving" : "offline");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void flush(); }, 800);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  // flush is stable for one attempt; adding it here would recreate the debounce when callbacks change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, enabled]);

  useEffect(() => {
    revisionRef.current = initialRevision;
  }, [initialRevision]);

  const flush = useCallback(async () => {
    if (!enabled) return true;
    if (conflictRef.current && !dirtyRef.current) return false;
    if (!navigator.onLine) { setStatus("offline"); return false; }
    if (runningRef.current) { dirtyRef.current = true; return runningRef.current; }
    const operation = (async () => {
      try {
        while (dirtyRef.current && navigator.onLine) {
          dirtyRef.current = false;
          const snapshot = serializeAnswers(answersRef.current);
          if (snapshot === savedSnapshotRef.current) continue;
          setStatus("saving");
          const revision = revisionRef.current + 1;
          const result = await api<SaveResponse>("student.save", {
            session_token: sessionToken,
            revision,
            answers: Object.entries(answersRef.current).map(([question_id, selected_option_ids]) => ({ question_id, selected_option_ids })),
          });
          revisionRef.current = result.revision;
          onRevision(result.revision);
          if (!result.accepted) {
            conflictRef.current = true;
            setStatus("conflict");
            return false;
          }
          conflictRef.current = false;
          savedSnapshotRef.current = snapshot;
          setLastSavedAt(result.saved_at);
          setStatus("saved");
          channelRef.current?.postMessage({ type: "saved", tabId: tabIdRef.current, revision: result.revision });
          if (serializeAnswers(answersRef.current) !== snapshot) dirtyRef.current = true;
        }
        return !dirtyRef.current;
      } catch {
        dirtyRef.current = true;
        setStatus(navigator.onLine ? "error" : "offline");
        return false;
      } finally {
        runningRef.current = null;
      }
    })();
    runningRef.current = operation;
    return operation;
  }, [enabled, onRevision, sessionToken]);

  const resetFromServer = useCallback((serverAnswers: Record<string, string[]>, revision: number) => {
    revisionRef.current = revision;
    savedSnapshotRef.current = serializeAnswers(serverAnswers);
    dirtyRef.current = false;
    conflictRef.current = false;
    setStatus(navigator.onLine ? "saved" : "offline");
    onRevision(revision);
  }, [onRevision]);

  useEffect(() => {
    const handleOnline = () => { setStatus(dirtyRef.current ? "saving" : "saved"); void flush(); };
    const handleOffline = () => setStatus("offline");
    window.addEventListener("online", handleOnline); window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, [flush]);

  useEffect(() => {
    if (!("BroadcastChannel" in window) || !attemptId) return;
    const channel = new BroadcastChannel(`attempt:${attemptId}`);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<{ type: string; tabId: string; revision?: number }>) => {
      if (!event.data || event.data.tabId === tabIdRef.current) return;
      setMultipleTabs(true);
      if (event.data.type === "presence") channel.postMessage({ type: "presence_ack", tabId: tabIdRef.current });
      if (event.data.type === "saved" && (event.data.revision ?? 0) > revisionRef.current) {
        revisionRef.current = event.data.revision!;
        conflictRef.current = true;
        setStatus("conflict");
      }
    };
    channel.postMessage({ type: "presence", tabId: tabIdRef.current });
    return () => { channel.close(); channelRef.current = null; };
  }, [attemptId]);

  return { status, lastSavedAt, multipleTabs, flush, resetFromServer };
}

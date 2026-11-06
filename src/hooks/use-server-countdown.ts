import { useEffect, useMemo, useRef, useState } from "react";
import { formatRemaining } from "@/lib/attempt-reliability";

export function useServerCountdown(deadline: string, serverTime: string, enabled: boolean, onExpire: () => void) {
  const offset = useMemo(() => Date.parse(serverTime) - Date.now(), [serverTime]);
  const calculate = () => Math.max(0, Math.ceil((Date.parse(deadline) - (Date.now() + offset)) / 1000));
  const [remaining, setRemaining] = useState(calculate);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    expiredRef.current = false;
    if (!enabled) return;
    const tick = () => {
      const next = calculate(); setRemaining(next);
      if (next <= 0 && !expiredRef.current) { expiredRef.current = true; onExpireRef.current(); }
    };
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  // deadline and offset fully determine the countdown; onExpire is kept in a ref.
  }, [deadline, enabled, offset]);
  return { remaining, label: formatRemaining(remaining) };
}

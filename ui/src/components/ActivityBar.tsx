import { useEffect, useRef, useState } from "react";

const THROTTLE_MS = 500;

/**
 * One fixed line between the log and the prompt: what the agent is doing now.
 * Shown while streaming, gone when the turn settles. The text updates at most
 * twice a second so it reads as a status, not a blur.
 */
export function ActivityBar({ activity, streaming }: { activity: string | undefined; streaming: boolean }) {
  const [shown, setShown] = useState<string | undefined>(activity);
  const latest = useRef(activity);
  const lastChange = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    latest.current = activity;
    const due = lastChange.current + THROTTLE_MS - Date.now();
    const apply = () => {
      lastChange.current = Date.now();
      setShown(latest.current);
      timer.current = undefined;
    };
    if (!streaming) {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
      setShown(undefined);
      return;
    }
    if (due <= 0) apply();
    else if (timer.current === undefined) timer.current = setTimeout(apply, due);
  }, [activity, streaming]);

  if (!streaming) return null;
  return (
    <div className="activity" data-testid="activity" aria-live="polite">
      <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="activity-text">{shown ?? "working"}</span>
    </div>
  );
}

import { useEffect, useState } from 'react';

/**
 * Current time that re-renders the screen every `intervalMs`, so "overdue" / "due today"
 * labels stay correct while a screen is open (and render stays pure).
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

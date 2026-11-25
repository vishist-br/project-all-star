/**
 * Rest timer logic. Pure and clock-free: the caller passes `now` (ms). The timer stores when the rest
 * ends, not a counter, so a phone that sleeps or a tab in the background still shows the right time.
 */
export type Rest = {
  /** Changes on every start, so the screen can tell a new rest from the same one. */
  id: number;
  endsAt: number;
  /** Seconds the rest was started with, plus any time added (for the progress bar). */
  totalSeconds: number;
};

export const ADD_SECONDS = 15;
export const MAX_REST_SECONDS = 900;

export function startRest(id: number, now: number, seconds: number): Rest {
  const s = Math.min(MAX_REST_SECONDS, Math.max(1, Math.round(seconds)));
  return { id, endsAt: now + s * 1000, totalSeconds: s };
}

/** Whole seconds left, never below 0. Rounds up so the display shows 1 until the very end. */
export function remainingSeconds(rest: Rest, now: number): number {
  return Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
}

export function addRest(rest: Rest, now: number, seconds = ADD_SECONDS): Rest {
  const left = remainingSeconds(rest, now);
  if (left <= 0) return startRest(rest.id, now, seconds);
  const total = Math.min(MAX_REST_SECONDS, left + seconds);
  return { ...rest, endsAt: now + total * 1000, totalSeconds: Math.min(MAX_REST_SECONDS, rest.totalSeconds + seconds) };
}

/** 0..100 of the rest that is already over. */
export function restPercent(rest: Rest, now: number): number {
  if (rest.totalSeconds <= 0) return 100;
  const done = 1 - Math.min(1, remainingSeconds(rest, now) / rest.totalSeconds);
  return Math.round(done * 100);
}

export function isRestOver(rest: Rest, now: number): boolean {
  return remainingSeconds(rest, now) <= 0;
}

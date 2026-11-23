/**
 * STAR-93: Server-Timing header for page responses. Only durations and fixed metric names go in
 * the header, never a URL, cookie, header value, id or query text, so nothing secret can leak.
 *
 * A response header is sent before a streamed page finishes (loading.tsx flushes the shell
 * early), so the value is the time the request spent in proxy.ts (cookie refresh, role routing)
 * measured from the first line of the proxy; the full download time is what e2e/perf-budget.spec.ts
 * asserts.
 */
export function serverTimingHeader(startMs: number, nowMs: number = performance.now()): string {
  const total = Math.max(0, nowMs - startMs);
  return `proxy;dur=${total.toFixed(1)}`;
}

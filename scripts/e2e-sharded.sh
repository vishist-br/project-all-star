#!/usr/bin/env bash
# Runs the whole Playwright suite (except the 40 minute ux-audit crawl) as six shards, one after the other.
# Each shard starts its own `next dev` and scratch database. One long run compiles every route into a single
# dev server whose memory grows until Next restarts it ("approaching the used memory threshold") or the OS
# kills it on a small machine; that shows up as ECONNRESET, ERR_CONNECTION_REFUSED or pages stuck on Loading.
# Usage: scripts/e2e-sharded.sh [port-base]   (default 3640; uses ports base..base+5 and DBs allstar_e2e_shard1..6)
set -u
base="${1:-3640}"
export E2E_WEBPACK="${E2E_WEBPACK:-1}"
shards=(
  "e2e/coach-members e2e/coach-plans e2e/coach-sessions e2e/customer-schedule e2e/customer-workouts"
  "e2e/cross-role --grep-invert=sweep"
  "e2e/cross-role --grep=sweep"
  "e2e/owner-coaches e2e/owner-dashboard e2e/owner-import e2e/perf-budget"
  "e2e/gym-extras e2e/live-workout e2e/plan-supersets e2e/progress-insights e2e/send-classes"
  "e2e/smoke e2e/ux-new-screens"
)
status=0
for i in "${!shards[@]}"; do
  n=$((i + 1))
  echo "=== shard $n: ${shards[$i]}"
  # shellcheck disable=SC2086
  E2E_DB_NAME="allstar_e2e_shard$n" E2E_PORT=$((base + i)) npx playwright test ${shards[$i]} || status=1
done
exit $status

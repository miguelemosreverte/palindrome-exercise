# Capacity Benchmark

Measures how many users a single OpenCode Railway instance can serve concurrently, and what isolation guarantees exist between users.

## What it tests

### 1. Session Creation Throughput
How fast can we spin up new user sessions? Each user gets an OpenCode session. This determines onboarding speed.

- Creates 1, 5, and 10 sessions in parallel
- Measures total time and per-session latency
- Reports total session count on the instance

### 2. Concurrent Message Handling
Can multiple users chat simultaneously, or does the instance serialize requests?

- Establishes a single-user baseline latency
- Sends 3 and 5 messages in parallel from different sessions
- Compares total wall-clock time vs baseline
- A ratio close to 1.0 means parallel; close to N means serialized

### 3. Filesystem Isolation
Do users share a filesystem? Can User B read files created by User A?

- User A writes a unique marker to `/tmp/isolation_{timestamp}.txt`
- User B (different session) tries to read that same file
- If B can read it → **shared filesystem** (users can see each other's data)
- If B cannot → **isolated** (safe for multi-tenant use)

### 4. Concurrent Code Execution
Does one user's long-running script block other users?

- User A runs `sleep 3 && echo SLOW_DONE`
- User B runs `echo FAST_DONE` 500ms later
- If User B completes quickly → parallel execution
- If User B waits for User A → serialized (one Python blocks everyone)

## Usage

```bash
# Full benchmark
node tests/capacity/benchmark.js

# Individual tests
node tests/capacity/benchmark.js sessions
node tests/capacity/benchmark.js concurrent
node tests/capacity/benchmark.js isolation
node tests/capacity/benchmark.js execution
```

## Results

Results are saved to `tests/capacity/results.json` with history of the last 10 runs.

### Expected findings

| Dimension | Single OpenCode instance | Impact |
|-----------|------------------------|--------|
| Session creation | Fast (~100ms/session) | Users can onboard instantly |
| Concurrent messages | Depends on LLM provider | Multiple users may experience delays |
| Filesystem | Likely **SHARED** | Need per-user directories |
| Code execution | Likely **serialized** | One user's script may block others |

### Scaling options (cheapest to most expensive)

1. **Per-user directories** — Create `/home/{userId}/` per session, set `cwd` accordingly. Cheapest, solves file isolation, doesn't solve execution blocking.

2. **OpenCode workspaces** — Use the `/experimental/workspace` API to create isolated workspaces per user. May solve both file isolation and execution.

3. **Multiple Railway instances** — Run N OpenCode containers, route users to them. Solves everything but costs N × container price.

4. **Per-user containers** — Spin up a container per user on demand, hibernate when idle. Best isolation, highest cost, most complex.

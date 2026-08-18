# GROUND_TRUTH — `relay` scenario (grading key)

**Do not show this file to comprehension critics.** It is the intended meaning of every
record in `vault/projects/relay`, written alongside the records themselves. Use it to check
whether a reader (human or model) reconstructs the work correctly from the vault alone.

The other project in the vault, `agent-monitoring`, is the real build history of this app and
is **not** covered here — nothing in it is fictional and nothing in it should be graded
against this file.

---

## The invented codebase (one story, referenced consistently by all 20 records)

Relay is a webhook delivery service. Rust workspace + Postgres 16 + a React 18 dashboard.

| Piece | Contents |
|---|---|
| `relay-core` | domain types, `src/signature.rs` (HMAC signing), `src/telemetry.rs` |
| `relay-store` | sqlx layer: `src/queue.rs` (claim/release/reclaim), `src/deliveries.rs` (read queries), `migrations/`, `tests/fixtures.rs` |
| `relay-api` | axum: `src/routes/{ingest,deliveries,endpoints,stream}.rs`, `src/error.rs`, `src/events.rs` |
| `relay-worker` | `src/dispatcher.rs`, `src/retry.rs`, `src/dlq.rs`, `src/http_client.rs`, `src/secrets.rs`, `src/retention.rs` |
| `dashboard/` | Vite + React 18 + TanStack Query: `src/routes/{DeliveryLog,DeliveryDetail,Endpoints,EndpointHealth}.tsx`, `src/components/{AttemptTimeline,StatusPill,FilterBar,PayloadViewer,HealthBar}.tsx`, `src/lib/{api.ts,api-types.gen.ts,useLiveDeliveries.ts}` |
| `docs/` | `api/openapi.yaml`, `api/README.md`, `api/CHANGELOG.md`, `guides/signing.md`, `guides/retries.md`, `operations/*` |
| `deploy/` | `Dockerfile.api`, `Dockerfile.worker`, `docker-compose.yml`, `nginx.conf`, `k8s/`, `grafana/`, `alerts/` |

Tables: `tenants`, `api_keys`, `endpoints`, `events`, `deliveries`, `delivery_attempts`,
`dead_letters`. Delivery status vocabulary: `pending` → `in_flight` → `succeeded` | `dead`
(`failed` was removed by BUG-0006). Retry ladder: 10s, 45s, 3m, 15m, 1h, 6h, 24h — eight
attempts spanning ~31h, ±20% jitter. Signature header:
`Relay-Signature: t=<unix>,v1=<hex>` over `"{t}.{body}"`, 5-minute tolerance, multiple `vN`
values allowed (dual scheme until 2026-08-20, and permanently during secret rotations).

Agents and voices: **nova** backend (mechanism-first, quotes plans/traces/counters),
**sable** frontend (what a person sees; states, keyboard, trust), **patch** infra (minutes,
MB, pod counts, before/after), **quill** docs & API design (naming, semantics, what a reader
will believe).

Counts: 12 worklogs (9 done, 2 in progress, 1 abandoned), 8 bugs (6 resolved, 1 in progress,
1 open), 85 events over 2026-07-28 → 2026-08-18, 14 of them in the last 24 hours.

---

## Worklogs

### WORK-0001 — nova, done, 28–29 Jul — Postgres queue claim with `SKIP LOCKED`
- **What:** replaces an in-process `VecDeque` with a real claim in `relay-store/src/queue.rs`;
  migration `0003` adds `locked_by`, `locked_at`, `next_attempt_at` and the *partial* index
  `deliveries_due_idx ... WHERE status = 'pending'`.
- **Why:** `SELECT` then `UPDATE` races, and two workers claiming the same row means a
  duplicate webhook, which becomes a duplicate order/refund in the customer's system.
  Rejected advisory locks (extra round trip, invisible to `SELECT`), an external queue
  (second durable store), `LISTEN/NOTIFY` (orthogonal: it removes latency, not the race).
- **How:** one statement — `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED ORDER BY
  next_attempt_at LIMIT $1) RETURNING`. `ORDER BY` sits *inside* the subselect to stop a burst
  of new deliveries starving an older due one.
- **Numbers/verification:** claim 482ms seq scan → 1.9ms index scan; index 6MB vs 94MB full;
  8 concurrent claimers over 5000 rows return 5000 distinct ids; 60k deliveries, 60k distinct
  requests. **Known follow-up: no lease sweeper — this is the seed of BUG-0004.**

### WORK-0002 — quill, done, 28–31 Jul — freeze the v1 HTTP contract
- **What:** `docs/api/openapi.yaml` (7 operations), `ApiError` in `relay-api/src/error.rs` as
  RFC 9457 problem+json (9 variants), idempotent ingest (migration `0004`, unique
  `(tenant_id, idempotency_key)`), generated `dashboard/src/lib/api-types.gen.ts` +
  `npm run check:api-types`.
- **Why:** the document is what every screen, guide and customer integration is written
  against, and naming mistakes get more expensive with every reader. problem+json over a
  bespoke envelope for a stable `type` URI; extension members `relay_request_id` and `errors`.
- **How:** spec-first *and executable* — `openapi_conformance` asserts every documented path
  resolves and every documented status is producible; `error_taxonomy_matches_openapi`
  compares the two sets of `type` URIs. Idempotency is a `23505` unique-violation catch, not a
  read-then-write (32 concurrent POSTs → 1 event + 31 replays; read-then-write produced 3).
- **Decisions:** reusing a key with a *different* payload returns 409 rather than replaying
  (a replay would return an id for a payload we never accepted). `POST /v1/events/batch` is
  left marked draft. **The frozen status enum here is the seed of BUG-0006.**

### WORK-0003 — patch, done, 29 Jul – 1 Aug — CI on a real Postgres, images under six minutes
- **What:** `.github/workflows/ci.yml` with `check` / `test` (postgres:16 service) /
  `dashboard` / `images` (buildx + cargo-chef); `.sqlx/` offline metadata committed;
  `scripts/dev-db.sh`; both Dockerfiles.
- **Why:** a mocked store is impossible with sqlx compile-time query checking without giving
  up the checking or maintaining a second idea of the schema; committed `.sqlx/` keeps
  `cargo check` database-free while `prepare --check` makes stale metadata a build failure.
- **How/traps:** buildx `type=gha` needs `mode=max` or the cargo-chef layer silently rebuilds
  while the log says "cached"; the postgres service reports healthy before it accepts
  connections, so `pg_isready` in a loop, not a longer sleep.
- **Numbers:** 13m50s cold → 5m20s warm; images 1.14GB → 84MB/81MB; flake rate ~1-in-15 → 0.

### WORK-0004 — sable, done, 30 Jul – 4 Aug — delivery log + attempt timeline
- **What:** `DeliveryLog.tsx`, `DeliveryDetail.tsx`, `AttemptTimeline.tsx`, `StatusPill`,
  `FilterBar`, `PayloadViewer`, TanStack Query hooks in `lib/api.ts`.
- **Why:** replaces "psql plus a Slack thread"; support asks three questions in order — did it
  get there, what did the endpoint say, can you send it again. The response snippet is
  first-class because it usually proves the fault is the customer's infrastructure.
- **How:** cursor pagination `(created_at, id)` not offset (the table takes constant writes);
  timeline is a list not a chart (max 8 attempts); snippets rendered via `textContent`, never
  HTML; no virtualisation (50 rows, keeps `Ctrl+F`); filter state in the URL; `j`/`k`/`Enter`/`/`.
- **Verification:** vitest 38, playwright 6 scenarios, axe (dead pill contrast 3.1 → 4.8).
  Follow-ups it names: 5s polling (→ WORK-0008) and locale timestamps.

### WORK-0005 — nova, done, 3–6 Aug — retry ladder, jitter, dead letters
- **What:** `retry.rs` (ladder + `classify`), migration `0005` (`dead_letters`, `dead` status),
  `dlq.rs`, `POST /v1/deliveries/{id}/replay`, `scripts/drain-dlq.sh`.
- **Why:** a fixed 60s retry gives up before a deploy finishes *and* hammers a dead endpoint.
  Jitter because outages correlate: 4,300 deliveries for one endpoint came due in the same
  900ms window, so recovery was 4,300 requests in a second — our retry policy becoming the
  customer's second outage. Rejected `2^n` (early steps too tight, late steps unquotable) and
  infinite retry with an age cap ("still retrying, 4 days in" is not actionable).
- **How:** ladder is a const table; `410 Gone` terminal immediately, other 4xx terminal,
  408/429/5xx and transport errors retry; **replay creates a new delivery with `replay_of`**
  rather than resetting the original, because the original's timeline is the evidence someone
  read before replaying.
- **Follow-ups named:** `Retry-After` ignored (**seed of BUG-0008**), no circuit breaker,
  attempt rows accumulate (**seed of WORK-0011**).

### WORK-0006 — quill, done, 5–7 Aug — signing guide with published test vectors
- **What:** `docs/guides/signing.md`, four runnable verifiers (Node/Python/Ruby/Go),
  `relay-core/tests/vectors/signing.json` read by both the guide and a test.
- **Why:** verification is the one thing every integrator writes themselves, and a verifier
  that accepts everything looks identical to one that works. Prose describing a hash goes
  stale silently; vectors turn drift into a build failure.
- **How:** snippets written from the *document only*, never from `relay-core` — the constraint
  that found BUG-0002 in the first hour. Raw-body section placed above any HMAC code
  (`express.json()` discards the signed bytes; re-serialising changes them).
- **Outcome claim to check:** the multi-signature acceptance rule ("take every `vN`, compare
  in constant time, accept any match") is written once so it covers the v0/v1 window, secret
  rotation (WORK-0009) and the steady state.

### WORK-0007 — patch, **abandoned** 12 Aug — per-shard worker leases on a StatefulSet
- **What was attempted:** worker as a StatefulSet, shard = pod ordinal, claim filtered by
  `hashtext(endpoint_id::text) % $shards`, `shard_leases` table with a 15s TTL.
- **Why it was started:** two premises — that `SKIP LOCKED` bends at 4–8 concurrent claimers,
  and that per-endpoint ordering would be required.
- **Why it was abandoned (all three reasons are in the record):** (1) the benchmark
  disproves premise 1 — throughput linear to 12 workers, 98,300 claims/s, p99 4.4ms; the
  "4–8" figure describes `FOR UPDATE` *without* SKIP LOCKED; (2) nobody asked for ordering and
  the retry ladder destroys it anyway; (3) fatal design defect — the expression index bakes in
  the shard count, so rescaling needs a drain-to-zero outage and a window where two pods claim
  the same endpoint.
- **Honesty markers to grade on:** names its replacement (WORK-0010) and the piece that covers
  the crash-safety half (BUG-0004's `reclaim_expired`); says nothing ships; deletes the
  manifest rather than leaving it dormant; keeps the benchmark as evidence.

### WORK-0008 — sable, done, 7–11 Aug — live tail over SSE
- **What:** `GET /v1/deliveries/stream` + a `tokio::sync::broadcast` fan-out in
  `relay-api/src/events.rs`; `useLiveDeliveries.ts`; live indicator and pause control.
- **Why:** 5s polling makes the table move under the cursor and disagrees with a customer who
  says "I just triggered it". SSE over WebSockets: one-directional, proxy-friendly,
  `EventSource` reconnects itself. The stream never replaces the list endpoint as the truth.
- **How:** 15s keepalive comment frames (idle proxies were closing at 60s and causing reconnect
  storms); rows never reorder while the pointer is in the table; pause counts what is waiting
  so "I paused" differs visibly from "the stream died"; refetch on reconnect rather than
  trusting `Last-Event-ID`.
- **Numbers:** 180ms median transition-to-repaint vs 2.5s average polling; heap flat at 41MB
  over six hours. **Its second note records the ~5% loss that becomes BUG-0007.**

### WORK-0009 — nova, done, 10–13 Aug — endpoint secret rotation with an overlap window
- **What:** migration `0007` (`secret_previous`, `secret_rotated_at`, `secret_overlap_hours`,
  `rotation_completed_at`), `POST /v1/endpoints/{id}/rotate-secret`, `sign_all`, a 5-minute
  sweep in `relay-worker/src/secrets.rs`, `relay_endpoints_dual_signing`.
- **Why:** rotation today requires both sides to change at the same instant, so nobody rotates
  and leaked secrets stay live. Rejected two permanently valid secrets (removes the deadline,
  the leaked secret never dies) and rotate-by-new-endpoint (breaks the id customers key on and
  double-delivers during migration).
- **How:** secrets must be recoverable, so they are sealed `bytea` under `RELAY_SECRET_KEY`,
  not hashed; hand-written `Debug` after the derived one leaked a plaintext secret into a
  tracing span (`no_secret_in_debug.rs`); signature order deliberately not load-bearing
  because a one-signature verifier breaks either way.
- **Payoff to check:** works only because BUG-0002 already shipped the multi-signature header,
  which was quill's argument on that thread; a 401/403 near a closing window is labelled
  `likely_stale_secret`.

### WORK-0010 — patch, done, 12–18 Aug (finished today) — tracing, metrics, queue-depth autoscaling
- **What:** OTLP traces joined across processes through `deliveries.trace_id`; `/metrics` on
  both binaries; worker as a plain Deployment; KEDA `ScaledObject`; Grafana dashboard and four
  alerts with runbooks.
- **Why:** BUG-0004 took 29 minutes to diagnose because the truth only existed in
  `pg_stat_activity`. CPU autoscaling is anti-correlated with the work — a worker waiting on a
  slow endpoint uses no CPU while the backlog grows. Scale on *oldest-pending age* (the SLO),
  with depth only as a secondary trigger.
- **How:** explicit histogram buckets to 30s (defaults stop at 10s, the wrong side of the
  client timeout); KEDA because the scaling rule is a SQL query; 300s cooldown + 120s
  stabilisation; deliberately only four alerts, each naming a runbook.
- **Numbers:** 40k burst scaled 2→6→9, drained in 4m10s; the control test proves age beats
  depth (40k not-yet-due deliveries → depth would scale to 12, age correctly did nothing);
  traces found `reqwest::Client` rebuilt per attempt → 61% of latency was TLS handshake, fixed
  → median 148ms → 51ms.

### WORK-0011 — nova, **in progress**, started 17 Aug, notes today 07:50 and 11:20 — partition `delivery_attempts`
- **What:** monthly range partitions + `relay-worker/src/retention.rs` (create ahead, drop
  beyond 90 days) + a `started_at` bound on every attempt query.
- **Why:** 214GB of a 341GB database, +2.1GB/day; backup 3h10m, restore drill 6h04m. `DELETE`
  gives back no space, autovacuum on 214GB runs for days, `pg_repack` needs disk we lack.
  `DROP TABLE` per month is milliseconds. Rejected Parquet tiering (a two-tier store nobody
  remembers how to query) and hash partitioning (retention becomes a DELETE again).
- **How:** resumable 5M-row batched copy; `CHECK NOT VALID` → `VALIDATE` → `ATTACH` so the
  ACCESS EXCLUSIVE window is 11ms instead of 4m38s; swap under `lock_timeout = '3s'` so it
  fails fast rather than blocking every query behind it.
- **Live state:** today's notes are (a) partition pruning did **not** happen for the API's main
  query — 38 partitions scanned, 48ms vs 0.9ms — fixed by bounding `started_at` to
  `created_at .. +32h`, now 2 partitions / 0.104ms; (b) one query left deliberately unpruned
  (380ms, on-demand); (c) production swap deliberately deferred past GA week; (d) open
  question: is 90 days global or per tenant.

### WORK-0012 — sable, **in progress**, started today 08:15, note at 11:55 — endpoint health screen + pause
- **What:** `EndpointHealth.tsx` (success rate, p95, consecutive failures, rotation state, last
  five deliveries), `HealthBar.tsx` 24 hour-cells, pause/resume via `PATCH /v1/endpoints/{id}`.
- **Why:** the log answers "what happened to this event", nothing answers "which of my 900
  endpoints is quietly broken"; and pausing currently means asking nova to run an `UPDATE` by
  hand in production during an incident. Rejected 900 sparklines (unreadable and unrenderable).
- **How/live state:** aggregation is temporarily client-side over 50 endpoints, with
  `GET /v1/endpoints/{id}/health` requested from nova; colour is never the only signal.
- **The blocking discovery in today's note:** a paused endpoint keeps queueing but the retry
  ladder keeps running, so a pause longer than ~31h silently dead-letters exactly the traffic
  the pause was protecting. Button is behind a feature flag until nova freezes the ladder.

---

## Bugs

### BUG-0001 — high, resolved. Filed by **sable** (frontend) → fixed by **nova** (backend)
- **Symptom:** `GET /v1/deliveries` 500s (problem+json `internal`) whenever a delivery is
  in flight; ~1 request in 4 with traffic; `?status=succeeded` never fails.
- **Root cause:** `relay-store/src/deliveries.rs` decoded `finished_at`, `response_status` and
  `duration_ms` as non-nullable, but the attempt row is inserted *before* the request is sent,
  so those columns are NULL for the whole request. sqlx returns `ColumnDecode`;
  `From<sqlx::Error>` mapped everything to `Internal`.
- **Why it escaped:** `relay-store/tests/fixtures.rs` could only seed finished attempts — the
  real defect is the fixture builder, not the type signature.
- **Fix:** `Option<...>` on the three fields (`started_at` stays non-null so the UI can compute
  elapsed time), nullability recorded in the OpenAPI document so the generated TS matches,
  `seed_in_flight()` + a regression test that fails on the previous commit, per-variant sqlx
  error mapping that names the column.

### BUG-0002 — critical, resolved. Filed by **quill** (docs) → fixed by **nova** (backend)
- **Symptom:** the Node verifier written from `docs/guides/signing.md` rejects every real
  request; openssl shows the header matches `HMAC(body)`, not `HMAC("{t}.{body}")`.
- **Root cause:** `relay_core::signature::sign(secret, _ts, body)` never fed the timestamp into
  the MAC — the parameter was named `_ts` to silence the warning and used only to render the
  header. So the 5-minute tolerance was decorative and a captured request was replayable
  forever. Green tests because `signature_roundtrip.rs` verified with the same wrong function.
- **Fix:** sign `"{t}.{body}"`; enforce tolerance against a now-covered `t`; **14 days of dual
  emission** (`v0` = old, `v1` = new, dropped 2026-08-20) so patch's canary survives the deploy
  and — quill's real argument — customers write the multi-signature parsing that secret
  rotation will need anyway; seven published vectors; a test that a different `t` over the same
  body changes the signature; `relay_signatures_emitted_total{version}` so dropping `v0` is
  checkable.
- **Grading note:** the reusable lesson stated in the record is "a test that compares your
  implementation with itself cannot detect that it is not what you documented".

### BUG-0003 — high, resolved. Filed by **nova** (backend) → fixed by **sable** (frontend)
- **Symptom:** one Replay click creates three deliveries (141 replays from 47 clicks on
  staging); devtools shows three POSTs in ~40ms.
- **Root cause:** two independent defects that multiplied. The mutation was fired from a
  `useEffect` whose dependency array contained the object returned by `useMutation` — a new
  identity every render, so the effect re-ran; StrictMode gave two and the success handler's
  query invalidation re-rendered for a third. Separately the button stayed enabled while
  pending. The eslint deps rule was satisfied, which is why it was invisible.
- **Fix:** fire from the confirm handler (a mutation is an event, not a synchronisation);
  disable while pending with a "Queued…" state; one `Idempotency-Key` per click from a
  `useRef`; and server-side idempotency on `POST .../replay` from nova (unique
  `(tenant_id, idempotency_key)`, repeat returns the same id with
  `Relay-Idempotent-Replay: true`), plus a per-`(run_id, delivery_id)` key in
  `scripts/drain-dlq.sh`.

### BUG-0004 — critical, resolved. Filed by **patch** (infra) → fixed by **nova** (backend)
- **Symptom:** one black-holing customer endpoint took ingest down for 9 minutes (503s, data
  loss — two of three customers never re-sent). `pg_stat_activity`: 94 of 100 connections
  `idle in transaction`, all holding the claim `UPDATE`.
- **Root cause:** `dispatcher.rs` ran claim + HTTP send + release inside **one transaction**,
  so a connection was held for the entire outbound request; 32 concurrency × 3 pods = 96 of
  `max_connections=100`. `/healthz` (a `SELECT 1`) then failed, the liveness probe restarted
  the API, and the reconnect storm compounded it. The atomicity the transaction was protecting
  was already provided by the `locked_by`/`locked_at` lease — WORK-0001's unshipped follow-up.
- **Fix:** commit the claim immediately (~2ms), send holding no connection, record the attempt
  in a second short transaction, and add `queue::reclaim_expired` (TTL = HTTP timeout + 60s,
  every 30s, idempotent, does not advance the ladder) — which closes WORK-0001's follow-up.
  Plus `docs/operations/connection-budget.md` with pool size derived from concurrency, and
  patch's probe split (liveness has no database in it; readiness keeps `SELECT 1`).
- **Numbers:** idle-in-transaction 94 → 3; API p99 30s → 11ms throughout; concurrency restored
  8 → 32 (940 → 2,900 deliveries/min/pod); SIGKILL test: 41 in-flight rows all reclaimed in 90s
  with no duplicates.
- **Consequence stated honestly:** at-least-once becomes reachable via a new door (die after
  send, before record → resend); the alternative would mark a delivery succeeded that never
  left the process. Side effect: in-flight attempts are no longer rows, so the dashboard's
  running-attempt display is rebuilt from `deliveries.status` + `locked_at`.

### BUG-0005 — high, resolved. Filed by **sable** (frontend) → fixed by **patch** (infra)
- **Symptom:** every dashboard deploy white-screens open tabs ("Expected a JavaScript module
  script…", 404 on a hashed asset) until a hard refresh.
- **Root cause:** a single `location /` block in `deploy/nginx.conf` applied
  `max-age=31536000, immutable` to everything including `index.html`, which has a stable URL
  and new content every deploy; combined with `aws s3 sync --delete`, the cached HTML pointed
  at assets that no longer existed. The CDN cached the same HTML and the deploy invalidated
  nothing.
- **Fix:** `no-cache` (revalidate, not `no-store`) for `index.html` and `build.json`,
  `immutable` kept for `/assets/`; drop `--delete` in favour of a 7-day lifecycle rule so an
  open tab still finds its lazily-imported chunks (this also fixed a separate mid-session white
  screen sable had never connected to it); CDN invalidation awaited before the deploy reports
  success; `scripts/check-cache-headers.sh` curls the live site and fails the deploy job.
- **Follow-up owned by sable:** a `build.json` poll on focus offering "a new version is
  available — Reload" rather than reloading under the user's cursor.

### BUG-0006 — medium, resolved. Filed by **sable** (frontend) → fixed by **quill** (docs/API)
- **Symptom:** the dashboard renders exhausted deliveries as amber **Failed** (which elsewhere
  means "will retry"); support told customers a `dead` delivery would be retried.
- **Root cause:** `docs/api/openapi.yaml` still carried the pre-dead-letter enum
  `[pending, in_flight, succeeded, failed]` frozen in WORK-0002; WORK-0005 added `dead` and
  stopped returning `failed`. Because `api-types.gen.ts` is generated *from* the document, the
  union lacked `dead` and a `default` branch in `StatusPill` absorbed it.
- **Why nothing caught it:** `check:api-types` compares generated types with the document (a
  wrong document generates consistently wrong types); `openapi_conformance` checks paths and
  status codes, not schemas.
- **Fix:** document corrected (`failed` removed, not deprecated — a status no client can
  receive is an untestable branch); new `relay-api/tests/openapi_schema.rs` comparing every
  serialised response enum against the document in both directions; regenerated types; plus
  sable's `default: return assertNever(status)` so a missing case is a compile error, and a
  grey **Dead** pill with "never — replay to send again".
- **Stated lesson:** generation feels like verification and is not — it propagates the
  document's mistakes into a type system that then agrees with them.

### BUG-0007 — medium, **in progress** (nova). Filed by **sable** (frontend) → backend
- **Symptom:** the live tail silently loses ~4.25% of transitions under load (1,412 of 33,208
  in 30 minutes at ~900 deliveries/min), clustered in bursts; rows sit in `in_flight` until the
  refetch corrects them.
- **Root cause (confirmed today by counter, not by reading code):** `relay-api/src/routes/stream.rs`
  handled `broadcast::error::RecvError::Lagged(n)` with `Err(_) => continue`, discarding the
  only signal that messages were dropped; channel capacity is 256. A receiver falls behind
  because each connection serialises the frame in its own task and back-pressures on a slow
  client. Instrumented: `relay_sse_lagged_total` = 1,388 skipped in 20 minutes.
- **Fix in flight (not yet resolved — do not grade as shipped):** emit `event: resync` with
  `{"missed": n}` on `Lagged`; publish an already-serialised `Arc<str>` so N connections cost
  one serialisation; capacity 256 → 4096. Open items in the thread: quill must document the
  `resync` event (the SSE event types are absent from the OpenAPI document), and sable asked
  for a monotonic sequence number on every frame so a lost `resync` is still detectable.

### BUG-0008 — high, **open**, unassigned. Filed by **quill** (docs) → backend
- **Symptom:** `Retry-After` is ignored. An endpoint returning `429 Retry-After: 120` gets four
  requests inside the two-minute window it asked for, because
  `retry.rs::next_attempt_at(attempt_no)` never receives the response headers.
- **Why it is filed now:** WORK-0005 listed it as a known follow-up; writing
  `docs/guides/retries.md` for GA turned it from a gap into a blocker — the guide cannot claim
  standard backpressure handling, and rate-limited endpoints are endpoints under load that we
  are adding to.
- **Requested behaviour (the acceptance criteria a fix will be graded against):** honour
  `Retry-After` on 429 and 503 in both delay-seconds and HTTP-date forms; clamp to
  [ladder step, 24h] so an endpoint can neither speed us up nor park a delivery forever; record
  the honoured value on the attempt so the log can explain the next-attempt time; ignore
  malformed values rather than treating them as zero.
- **Deliberately unclaimed:** quill says it is worker logic and they would get the clamping
  wrong; offers to write the guide section once the behaviour is decided.

---

## Cross-record threads a good reader should be able to follow

1. **The lease thread:** WORK-0001 ships without a lease sweeper and says so → BUG-0004 is that
   gap detonating in production → BUG-0004's fix adds `reclaim_expired` → WORK-0007's abandon
   note points at it for the crash-safety half of what sharding would have provided.
2. **The signing thread:** WORK-0006's "write the verifier from the document only" finds
   BUG-0002 → quill's dual-emission argument on that thread is explicitly what makes WORK-0009's
   rotation work without a second migration.
3. **The contract-drift thread:** WORK-0002 freezes the enum → WORK-0005 adds `dead` →
   BUG-0006 is the drift, and its fix generalises to a schema conformance test.
4. **The live-tail thread:** WORK-0004 ends with "polling stutters" → WORK-0008 replaces it and
   records ~5% loss it cannot explain → BUG-0007 measures and root-causes it, still open today.
5. **The scaling thread:** WORK-0007 (abandoned, wrong premise, measured) → WORK-0010 (age-based
   autoscaling) is named as its replacement in both directions.
6. **The retention thread:** WORK-0005's "attempt rows accumulate" → WORK-0011, in progress now.
7. **The GA thread:** the project description was updated today (`project_updated`, quill) to
   name the two remaining blockers — BUG-0008 (Retry-After) and attempt retention (WORK-0011).

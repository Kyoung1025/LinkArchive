# LinkArchive

A link-archiving service that saves a URL, fetches its metadata (title / description / thumbnail) in the background, and lets you organize saved links with tags and search.

**Purpose**: this is an infrastructure-engineer portfolio project. The point isn't the feature set — it's a production-shaped **async worker-queue architecture** (API server, Redis queue, and worker as independently deployable processes) that can carry a cloud-infra learning path forward step by step: Docker → Terraform → Kubernetes, aligned with the KT Cloud K-Digital Training curriculum.

## Architecture

```
[React frontend (Vite + TS)]
      │ POST /links { url }
      ▼
[NestJS API server] ── writes status="pending" to Postgres, returns immediately (no synchronous wait)
      │ push job
      ▼
[Redis queue (BullMQ) — "link-scrape"]
      ▼
[Worker process — separate process/container]
      │ fetch URL → parse Open Graph tags, fallback to <title>/<meta description>
      ├── success → status="completed" + title/description/thumbnail saved
      └── failure → retry up to 3× (exponential backoff) → status="failed" + error_message
      ▼
[Postgres] ◀── both the API server and the worker read/write here directly
      ▲
      │ GET /links polled every 2–3s
[React frontend] shows the status transition pending → processing → completed/failed
```

The API server and the worker never call each other directly — Redis (the queue) and Postgres (the shared database) are the only coupling between them. Each could be redeployed, restarted, or scaled independently without the other knowing. See [`docs/architecture.md`](docs/architecture.md) for the full design rationale, retry behavior, and observability details.

### Why the API server and the worker are separate processes

Fetching a URL and parsing its HTML is slow and unpredictable — some sites take 10+ seconds, some hang, some fail outright. If that work ran inline inside the request handler, `POST /links` would block on the slowest possible external site, and a burst of saves would exhaust the API server's request-handling capacity. Splitting the write path (accept the URL, persist `pending`, enqueue a job, return) from the work path (dequeue, fetch, parse, persist the result) means the API server's request latency is constant regardless of scraping load, and the two halves scale independently: the API server scales with user traffic, the worker scales with queue depth. That's also why this repo is structured as a monorepo but with `backend/api` and `backend/worker` as separate packages with separate entrypoints from day one — they're meant to become separate Docker images and, eventually, separate Kubernetes Deployments where only the worker gets a HorizontalPodAutoscaler keyed on queue length.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript (Vite) | |
| API server | NestJS (Node.js + TypeScript) | Module/DI structure makes the API/worker/shared boundary explicit in code, not just in folders |
| Worker | Node.js + TypeScript, BullMQ | Same language as the API server → shared types/interfaces via `backend/shared` |
| Queue | Redis (via BullMQ) | |
| Database | PostgreSQL, Prisma | Schema-as-code migrations |
| Scraping | undici (fetch) + cheerio | Open Graph tags first, `<title>`/`<meta description>` fallback |
| Observability | pino / nestjs-pino, prom-client, `@nestjs/terminus` | JSON logs, Prometheus metrics, DB+Redis health checks — see below |

## Project layout

```
LinkArchive/
├── frontend/          # React + TS (Vite) — save form, card grid, status polling, tag filter, search
├── backend/
│   ├── api/           # NestJS: /links, /tags, /health, /metrics
│   ├── worker/        # BullMQ worker: scrape → retry → persist
│   └── shared/        # Prisma schema + generated client, shared TS types (used by api & worker)
├── docs/
│   └── architecture.md
└── scripts/
    └── setup-env.sh   # copies .env.example into each package
```

## Running locally

**Prerequisites**: Node.js 20+, Docker (for local Postgres/Redis — or point at your own).

```bash
# 1. install all workspace dependencies
npm install

# 2. start Postgres + Redis (or use your own and skip this)
docker run -d --name linkarchive-postgres \
  -e POSTGRES_USER=linkarchive -e POSTGRES_PASSWORD=linkarchive -e POSTGRES_DB=linkarchive \
  -p 5432:5432 postgres:16-alpine
docker run -d --name linkarchive-redis -p 6379:6379 redis:7-alpine

# 3. create .env files (one per package — each process loads its own)
npm run setup:env

# 4. run the Prisma migration
npm run prisma:migrate

# 5. run everything, each in its own terminal
npm run dev:api        # http://localhost:3000
npm run dev:worker      # exposes metrics on http://localhost:9100/metrics
npm run dev:frontend     # http://localhost:5173
```

Save a link from the UI (or `curl -X POST localhost:3000/links -H "Content-Type: application/json" -d '{"url":"https://example.com"}'`) and watch its status move from `pending` → `processing` → `completed`/`failed` as the frontend polls.

## API

| Endpoint | Description |
|---|---|
| `POST /links` | `{ url }` → persists `status=pending`, enqueues a scrape job, returns immediately |
| `GET /links` | List links. Query params: `status`, `tag`, `search` (matches title or tag name) |
| `GET /links/:id` | Fetch one link |
| `DELETE /links/:id` | Delete a link |
| `POST /links/:id/tags` | `{ name }` → creates the tag if needed and attaches it |
| `DELETE /links/:id/tags/:tagId` | Detach a tag |
| `GET /tags` | List all tags |
| `GET /health` | Checks API liveness + DB connection + Redis connection independently |
| `GET /metrics` | Prometheus format: queue depth, links-created counter, default Node.js process metrics |

The worker exposes its own `GET /metrics` (default port `9100`) with scrape success/failure counters and a duration histogram — each worker replica is meant to be scraped independently once this runs in Kubernetes, rather than routing worker metrics through the API server.

## Observability

- **Structured logging**: every log line from both processes is JSON with `timestamp`, `level`, `service` (`api`/`worker`), `message`, and relevant context (`linkId`, retry attempt number, failure reason). The API uses `nestjs-pino` (so framework logs and HTTP request logs come out JSON too, for free); the worker uses `pino` directly.
- **Health checks**: `/health` checks the database and Redis independently via `@nestjs/terminus`, so a dashboard/alert can tell *which* dependency is down.
- **Metrics**: both processes expose Prometheus-format `/metrics` (via `prom-client`) — queue depth and links-created on the API side, scrape success/failure counts and duration histogram on the worker side.
- **Retry visibility**: every scrape attempt (success or failure) is logged with the attempt number and, on failure, the specific error; the final failure after 3 attempts persists the error message to `links.error_message`.

## Roadmap

- [ ] Dockerize the API server, worker, and frontend as separate images; `docker-compose.yml` for local multi-container dev
- [ ] Terraform: provision the cloud infra (managed Postgres, Redis, container hosting) as code
- [ ] Kubernetes: separate Deployments for API and worker, with the worker's replica count autoscaled on BullMQ queue depth
- [ ] CI/CD pipeline (lint/typecheck/build on PR, image build + deploy on merge)

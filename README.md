# LinkArchive

URL을 저장하면 백그라운드에서 메타데이터(제목/설명/썸네일)를 자동으로 가져오고, 태그와 검색으로 저장한 링크를 정리할 수 있는 링크 아카이브 서비스입니다.

**목적**: 기능의 화려함보다, **비동기 워커 큐 아키텍처**(API 서버·Redis 큐·워커를 독립적으로 배포 가능한 프로세스로 분리)를 프로덕션급으로 설계해서, Docker → Terraform → Kubernetes 순으로 클라우드 인프라 학습을 단계적으로 얹을 수 있게 만드는 것입니다.

## 아키텍처

```
[React 프론트엔드 (Vite + TS)]
      │ POST /links { url }
      ▼
[NestJS API 서버] ── Postgres에 status="pending"으로 기록하고 즉시 응답 (동기 대기 없음)
      │ job push
      ▼
[Redis 큐 (BullMQ) — "link-scrape"]
      ▼
[워커 프로세스 — 별도 프로세스/컨테이너]
      │ URL fetch → Open Graph 태그 파싱, 없으면 <title>/<meta description>으로 폴백
      ├── 성공 → status="completed" + title/description/thumbnail 저장
      └── 실패 → 최대 3회 재시도(지수 백오프) → status="failed" + error_message
      ▼
[Postgres] ◀── API 서버와 워커 둘 다 여기에 직접 읽고 씀
      ▲
      │ 2~3초 간격으로 GET /links 폴링
[React 프론트엔드] pending → processing → completed/failed 상태 전환을 화면에 표시
```

API 서버와 워커는 서로 직접 호출하지 않습니다 — 둘을 이어주는 건 Redis(큐)와 Postgres(공유 DB)뿐입니다. 서로의 존재를 몰라도 각자 재배포·재시작·스케일링이 가능합니다. 설계 근거, 재시도 동작, 관측성(Observability) 세부 내용은 [`docs/architecture.md`](docs/architecture.md)를 참고하세요.

### 왜 API 서버와 워커를 별도 프로세스로 분리했는가

URL을 가져와서 HTML을 파싱하는 작업은 느리고 예측하기 어렵습니다 — 어떤 사이트는 10초 넘게 걸리고, 어떤 사이트는 응답이 멈추고, 어떤 사이트는 아예 실패합니다. 이 작업을 요청 핸들러 안에서 동기적으로 처리했다면 `POST /links`가 그 순간 가장 느린 외부 사이트에 발목 잡히고, 저장 요청이 몰릴 때마다 API 서버의 요청 처리 능력 자체가 고갈됐을 겁니다. 쓰기 경로(URL을 받아 `pending`으로 저장하고 job을 큐에 넣은 뒤 즉시 응답)와 작업 경로(큐에서 꺼내 fetch·파싱하고 결과를 저장)를 분리하면, 스크래핑 부하와 무관하게 API 서버의 응답 지연이 일정하게 유지되고, 두 축이 독립적으로 스케일링됩니다 — API 서버는 사용자 트래픽에 맞춰, 워커는 큐 길이에 맞춰 확장합니다. 이 저장소가 처음부터 모노레포이면서도 `backend/api`와 `backend/worker`를 별도 패키지·별도 진입점으로 나눠둔 이유도 여기에 있습니다 — 이 구조가 나중에 별도 Docker 이미지가 되고, 궁극적으로는 워커에만 큐 길이 기반 HorizontalPodAutoscaler가 붙는 별도 Kubernetes Deployment가 되어야 하기 때문입니다.

## 기술 스택

| 계층 | 선택 | 이유 |
|---|---|---|
| 프론트엔드 | React + TypeScript (Vite) | |
| API 서버 | NestJS (Node.js + TypeScript) | 모듈/DI 구조 덕분에 API/워커/공용 코드의 경계가 폴더 구분을 넘어 코드 상에서도 명확하게 드러남 |
| 워커 | Node.js + TypeScript, BullMQ | API 서버와 언어를 통일해 `backend/shared`로 타입/인터페이스 공유 |
| 메시지 큐 | Redis (BullMQ 기반) | |
| DB | PostgreSQL, Prisma | 스키마를 코드로 관리하는 마이그레이션 |
| 스크래핑 | undici (fetch) + cheerio | Open Graph 태그 우선, `<title>`/`<meta description>`으로 폴백 |
| 관측성 | pino / nestjs-pino, prom-client, `@nestjs/terminus` | JSON 로그, Prometheus 메트릭, DB+Redis 헬스체크 — 아래 참고 |

## 프로젝트 구조

```
LinkArchive/
├── frontend/          # React + TS (Vite) — 저장 폼, 카드 그리드, 상태 폴링, 태그 필터, 검색
├── backend/
│   ├── api/           # NestJS: /links, /tags, /health, /metrics
│   ├── worker/        # BullMQ 워커: 스크래핑 → 재시도 → DB 반영
│   └── shared/        # Prisma 스키마 + 생성된 클라이언트, 공용 TS 타입 (api & worker 공용)
├── docs/
│   └── architecture.md
└── scripts/
    └── setup-env.sh   # .env.example을 각 패키지에 복사
```

## 로컬 실행 방법

**사전 준비**: Node.js 20+, Docker (로컬 Postgres/Redis용 — 직접 준비한 DB/Redis를 써도 됩니다).

```bash
# 1. 워크스페이스 전체 의존성 설치
npm install

# 2. Postgres + Redis 실행 (이미 준비된 게 있다면 생략 가능)
docker run -d --name linkarchive-postgres \
  -e POSTGRES_USER=linkarchive -e POSTGRES_PASSWORD=linkarchive -e POSTGRES_DB=linkarchive \
  -p 5432:5432 postgres:16-alpine
docker run -d --name linkarchive-redis -p 6379:6379 redis:7-alpine

# 3. .env 파일 생성 (패키지마다 각자 자신의 .env를 읽음)
npm run setup:env

# 4. Prisma 마이그레이션 실행
npm run prisma:migrate

# 5. 각각 별도 터미널에서 실행
npm run dev:api        # http://localhost:3000
npm run dev:worker      # http://localhost:9100/metrics 로 메트릭 노출
npm run dev:frontend     # http://localhost:5173
```

UI에서 링크를 저장하거나 (`curl -X POST localhost:3000/links -H "Content-Type: application/json" -d '{"url":"https://example.com"}'`) 직접 호출해보면, 프론트엔드가 폴링하면서 상태가 `pending` → `processing` → `completed`/`failed`로 바뀌는 걸 확인할 수 있습니다.

## API

| 엔드포인트 | 설명 |
|---|---|
| `POST /links` | `{ url }` → `status=pending`으로 저장하고 스크래핑 job을 큐에 넣은 뒤 즉시 응답 |
| `GET /links` | 목록 조회. 쿼리 파라미터: `status`, `tag`, `search`(제목 또는 태그명과 매칭) |
| `GET /links/:id` | 단건 조회 |
| `DELETE /links/:id` | 삭제 |
| `POST /links/:id/tags` | `{ name }` → 태그가 없으면 생성하고 링크에 연결 |
| `DELETE /links/:id/tags/:tagId` | 태그 연결 해제 |
| `GET /tags` | 전체 태그 목록 |
| `GET /health` | API 자체 상태 + DB 연결 + Redis 연결을 각각 확인 |
| `GET /metrics` | Prometheus 포맷: 큐 대기 길이, 링크 생성 카운터, Node.js 기본 프로세스 메트릭 |

워커도 자체 `GET /metrics`(기본 포트 `9100`)를 노출합니다 — 스크래핑 성공/실패 카운터와 처리 시간 히스토그램을 담고 있습니다. 워커 메트릭을 API 서버로 우회시키지 않고 각 워커 인스턴스가 독립적으로 노출하도록 만든 이유는, 나중에 Kubernetes에서 워커 파드가 여러 개로 늘어났을 때 각 파드를 개별 Prometheus 타겟으로 스크랩해야 하기 때문입니다.

## 관측 가능성 (Observability)

- **구조화된 로깅**: 두 프로세스 모두 `timestamp`, `level`, `service`(`api`/`worker`), `message`와 관련 컨텍스트(`linkId`, 재시도 횟수, 실패 사유)를 담은 JSON 로그를 남깁니다. API는 `nestjs-pino`를 사용해 프레임워크 로그와 HTTP 요청 로그까지 별도 작업 없이 JSON으로 나오고, 워커는 `pino`를 직접 사용합니다.
- **헬스체크**: `/health`가 `@nestjs/terminus`로 DB와 Redis 연결을 각각 확인하므로, 대시보드/알림에서 *어느* 의존성이 죽었는지 바로 알 수 있습니다.
- **메트릭**: 두 프로세스 모두 `prom-client`로 Prometheus 포맷 `/metrics`를 노출합니다 — API 쪽은 큐 길이와 링크 생성 수, 워커 쪽은 스크래핑 성공/실패 카운트와 처리 시간 히스토그램입니다.
- **재시도 가시성**: 모든 스크래핑 시도(성공/실패 모두)가 시도 횟수와 함께 로그로 남고, 실패 시에는 구체적인 에러 내용도 함께 기록됩니다. 3회 재시도를 모두 소진한 최종 실패는 `links.error_message`에 저장됩니다.

## 로드맵

- [ ] API 서버, 워커, 프론트엔드를 별도 이미지로 Docker화; 로컬 멀티 컨테이너 개발용 `docker-compose.yml`
- [ ] Terraform: 클라우드 인프라(관리형 Postgres, Redis, 컨테이너 호스팅)를 코드로 프로비저닝
- [ ] Kubernetes: API와 워커를 별도 Deployment로 분리하고, 워커는 BullMQ 큐 길이 기준으로 레플리카 수 오토스케일링
- [ ] CI/CD 파이프라인 (PR에서 lint/타입체크/빌드, merge 시 이미지 빌드 + 배포)

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
├── frontend/                             # React + TS (Vite)
│   └── src/
│       ├── api/
│       │   ├── client.ts                 # fetch 래퍼 — 백엔드 API 호출
│       │   └── types.ts                  # Link/Tag 등 프론트-백엔드 공유 타입
│       ├── components/
│       │   ├── LinkCard.tsx              # 카드 1개 (썸네일/제목/설명/태그/삭제)
│       │   ├── LinkForm.tsx              # URL 저장 폼
│       │   ├── LinkList.tsx              # 카드 그리드 + 로딩/빈 상태
│       │   ├── SearchBar.tsx             # 검색 입력 (디바운스)
│       │   ├── StatusBadge.tsx           # pending/processing/completed/failed 배지
│       │   └── TagFilterBar.tsx          # 태그 필터 칩
│       ├── hooks/
│       │   ├── useLinks.ts               # 목록 조회 + 2~3초 상태 폴링
│       │   └── useTags.ts                # 태그 목록 조회
│       ├── App.tsx                       # 최상위 컴포넌트 — 상태/필터 조합
│       ├── App.css                       # 레이아웃 + 컴포넌트 스타일
│       ├── index.css                     # 전역 리셋 + 다크 테마 변수
│       └── main.tsx                      # React 진입점
│
├── backend/
│   ├── api/                              # NestJS API 서버
│   │   ├── src/
│   │   │   ├── links/
│   │   │   │   ├── dto/
│   │   │   │   │   ├── create-link.dto.ts    # POST /links 바디 검증
│   │   │   │   │   └── query-links.dto.ts    # GET /links 쿼리 검증
│   │   │   │   ├── links.controller.ts       # POST/GET/DELETE /links, 태그 서브라우트
│   │   │   │   ├── links.service.ts          # 저장·조회·삭제·필터링 로직
│   │   │   │   └── links.module.ts
│   │   │   ├── tags/
│   │   │   │   ├── dto/add-tag.dto.ts        # 태그 이름 검증
│   │   │   │   ├── tags.controller.ts        # GET /tags
│   │   │   │   ├── tags.service.ts           # 태그 upsert/연결/해제
│   │   │   │   └── tags.module.ts
│   │   │   ├── health/
│   │   │   │   ├── health.controller.ts      # GET /health — DB+Redis 개별 체크
│   │   │   │   └── health.module.ts
│   │   │   ├── metrics/
│   │   │   │   ├── metrics.controller.ts     # GET /metrics
│   │   │   │   ├── metrics.service.ts        # prom-client 레지스트리/카운터/게이지
│   │   │   │   └── metrics.module.ts
│   │   │   ├── prisma/
│   │   │   │   ├── prisma.service.ts         # PrismaClient 커넥션 lifecycle
│   │   │   │   └── prisma.module.ts
│   │   │   ├── queue/
│   │   │   │   ├── queue.service.ts          # BullMQ 큐 producer (job push)
│   │   │   │   └── queue.module.ts
│   │   │   ├── redis/
│   │   │   │   ├── redis.service.ts          # ioredis 커넥션 (헬스체크용)
│   │   │   │   └── redis.module.ts
│   │   │   ├── app.module.ts                 # 모듈 조립 + 로깅 설정
│   │   │   └── main.ts                       # 부트스트랩, CORS, ValidationPipe
│   │   └── test/
│   │       └── links/
│   │           └── links.service.spec.ts     # LinksService 유닛 테스트
│   │
│   ├── worker/                           # BullMQ 워커 (API와 별도 프로세스)
│   │   ├── src/
│   │   │   ├── scrape.ts                     # URL fetch + Open Graph 태그 파싱
│   │   │   ├── job-processor.ts              # job 처리 로직 (테스트에서 재사용하도록 분리)
│   │   │   ├── logger.ts                     # pino 구조화 로깅
│   │   │   ├── metrics.ts                    # 워커 자체 /metrics HTTP 서버
│   │   │   └── main.ts                       # Worker 기동 + 그레이스풀 셧다운
│   │   └── test/
│   │       ├── scrape.spec.ts                # scrapeUrl 유닛 테스트
│   │       └── integration/
│   │           ├── test-server.ts                    # 테스트용 로컬 HTTP 서버 헬퍼
│   │           ├── pipeline.integration.spec.ts       # 전체 파이프라인 통합 테스트
│   │           └── concurrency.integration.spec.ts    # 동시성 테스트
│   │
│   └── shared/                           # api & worker 공용
│       ├── prisma/
│       │   ├── schema.prisma                 # links/tags/link_tags 스키마
│       │   └── migrations/
│       │       ├── migration_lock.toml
│       │       └── 20260806185208_init/
│       │           └── migration.sql
│       └── src/
│           ├── index.ts                      # Prisma Client + 타입 재수출
│           └── queue.ts                      # 큐 이름, job payload 타입
│
├── docs/
│   └── architecture.md               # 설계 근거, 재시도/관측성, 트러블슈팅 기록
│
└── scripts/
    └── setup-env.sh                  # .env.example을 각 패키지에 복사
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

## 테스트

### 유닛 테스트 — 인프라 없이 실행 가능

```bash
npm run test --workspace=backend/api      # LinksService: create/findAll/findOne/remove
npm run test --workspace=backend/worker   # scrapeUrl: OG 태그, 폴백, 실패 처리
```

Jest + `ts-jest` 기반입니다. 실제 DB/Redis/네트워크 없이, 의존성(Prisma, Queue, undici의 `fetch` 등)을 mock으로 대체해서 각 함수 하나만 떼어놓고 검증합니다 — 그래서 위 명령어는 Postgres/Redis가 안 떠 있어도 그대로 실행됩니다. 커버 범위:

- **`LinksService`** (`backend/api/test/links/links.service.spec.ts`): 링크 생성 시 DB 저장·큐 등록·메트릭 증가·태그 응답 형태, `status`/`tag`/`search` 조합 필터링, 단건 조회 404 처리, 삭제 시 존재 확인 후에만 delete 호출
- **`scrapeUrl`** (`backend/worker/test/scrape.spec.ts`): Open Graph 태그 우선 추출, `<title>`/`<meta description>`으로 폴백, 메타데이터가 전혀 없을 때 처리, 상대경로 `og:image`의 절대경로 변환, HTTP 실패 상태 코드 처리, 요청 헤더(User-Agent/Accept) 검증

### 통합 테스트 — 실제 Postgres + Redis 필요

```bash
# Postgres/Redis가 떠 있어야 함 (로컬 실행 방법의 2번 참고)
npm run test:integration --workspace=backend/worker
```

유닛 테스트는 각 함수를 mock으로 고립시켜서 검증하지만, "저장 → 큐 push → 워커 처리 → DB 반영"이 실제로 엮여서 도는지는 그것만으로는 증명되지 않습니다. `backend/worker/test/integration/`은 실제 Redis 큐 + 실제 BullMQ Worker(프로덕션과 동일한 `job-processor.ts`) + 실제 Postgres로 전체 배관을 검증합니다. 외부 사이트만 로컬 HTTP 서버로 대체해서 빠르고 결정적으로 만들었습니다 (OG 파싱 로직 자체는 이미 유닛 테스트가 커버).

- **`pipeline.integration.spec.ts`**: 링크 생성 → 큐에 job 추가 → 워커가 실제로 집어서 처리 → DB에 `completed`+메타데이터로 반영됨을 확인. 존재하지 않는 주소로는 재시도 소진 후 `failed`+`error_message`까지 확인.
- **`concurrency.integration.spec.ts`**: 워커의 `concurrency: 5` 설정이 실제로 병렬 처리되는지 검증. `WORKER_CONCURRENCY`보다 많은 링크를 동시에 저장하고, 로컬 서버가 동시 요청 수를 직접 세어(`maxInFlight`) 1개 초과로 겹쳤음을 확인하며, 각 링크가 서로 다른 페이지의 제목을 정확히 받았는지(동시 처리 중 결과가 뒤섞이지 않았는지)까지 검증.

이 두 파일은 기본 `npm run test`에는 포함되지 않습니다(별도 `jest.integration.config.js`) — 실제 인프라가 필요해서 순수 유닛 테스트와 실행 속도·전제조건이 다르기 때문입니다.

아직 컨트롤러·프론트엔드 테스트, 그리고 API 서버까지 포함한 진짜 E2E(HTTP 요청부터 시작하는) 테스트는 없습니다 (로드맵 참고).

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

**완성 기준**: Docker/Terraform/Kubernetes를 얹는 것만으로 "완성"이 아닙니다. 실제 채용 과정에서 확인하는 것 — 테스트, 정리된 커밋 히스토리, 접속 가능한 데모, CI/CD, 최종 문서화 — 까지 포함해서 아래 순서로 진행합니다. 부트캠프 시작(2026-08-19) 기준 132일 일정(~2027년 3월 초 종료)에 맞춘 단계별 계획입니다.

### 1단계 


- [x] `LinksService` 유닛 테스트 (`backend/api/test/links/links.service.spec.ts`, Jest)
- [x] 워커 `scrapeUrl` 유닛 테스트 (`backend/worker/test/scrape.spec.ts`, Jest)
- [ ] 지금부터 커밋을 기능 단위로 쪼개는 습관 적용 (테스트 추가도 별도 커밋으로)
- [x] `docs/architecture.md` 재검토 — 재시도 설정·메트릭 포트·헬스체크·로그 필드 전부 코드와 일치 확인, 테스트 전략 섹션 추가

### 2단계 


- [ ] 리눅스/네트워크: 로컬 배포 환경 세팅 연습 (아직 클라우드 아님)
- [ ] Docker: API/워커/프론트엔드/DB/Redis 각각 컨테이너화 + `docker-compose.yml` 작성
- [ ] Terraform: 클라우드 인프라(관리형 Postgres/Redis, 컨테이너 호스팅)를 IaC로 정의
- [ ] Kubernetes: API/워커를 별도 Deployment로 분리, 워커는 BullMQ 큐 길이 기준 HorizontalPodAutoscaler

### 3단계 


- [ ] GitHub Actions: PR에서 lint/타입체크/빌드
- [ ] merge 시 이미지 빌드 + 배포 자동화

### 4단계 

- [ ] 실제 클라우드에 배포해서 접속 가능한 데모 URL 확보 — 크레딧 소진 전에 스크린샷/영상으로 기록해두기 (크레딧 끝나면 서비스는 내려야 함)
- [ ] README 최종 업데이트: 완성된 아키텍처 다이어그램, 트러블슈팅 기록
- [ ] 커밋 히스토리 재점검 — 스토리가 잘 읽히는지 확인

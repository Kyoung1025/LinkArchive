# 아키텍처

## 개요

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

## 왜 API 서버와 워커를 별도 프로세스로 분리했는가

임의의 URL을 가져와서 HTML을 파싱하는 작업은 느리고 소요 시간을 예측할 수 없습니다 — 어떤 사이트는 밀리초 단위로 응답하지만, 어떤 사이트는 10초 넘게 걸리거나 타임아웃까지 응답이 멈추고, 일부는 아예 실패합니다. 이 작업이 `POST /links` 핸들러 안에서 동기적으로 일어났다면 API 서버의 응답 시간은 그 순간 스크래핑 중인 가장 느린 외부 사이트에 좌우됐을 것이고, 링크 저장 요청이 몰릴 때마다 실제 병목(제3자 서버로의 네트워크 I/O)과는 무관한 요청 처리 용량이 잠식됐을 겁니다.

요청을 **쓰기 경로**(URL 검증, `status=pending` 저장, job 큐잉, `201` 응답)와 **작업 경로**(dequeue, fetch, 파싱, 결과 저장)로 분리하면 다음과 같은 이점이 있습니다:

- 스크래핑이 아무리 느려도 API 서버가 그걸 기다리지 않으므로 `POST /links`의 지연 시간이 거의 일정하게 유지됩니다.
- 두 축이 독립적으로 실패합니다. 워커가 전부 죽어도 링크 저장 자체는 계속되고(워커가 돌아와서 큐를 비울 때까지 `pending` 상태로 쌓여있을 뿐), API 서버가 재시작돼도 Redis에 있는 진행 중인 스크래핑 job은 영향을 받지 않습니다.
- 두 축이 서로 다른 기준으로 스케일링됩니다: API 서버는 사용자 요청량에 맞춰, 워커는 큐 길이에 맞춰 확장됩니다. 하나의 프로세스로 묶었다면 한쪽을 위해 다른 쪽까지 같이 스케일링해야 했을 겁니다.

이 저장소가 첫 커밋부터 `backend/api`와 `backend/worker`를 별도 npm 패키지·별도 진입점으로 구성하고, `backend/shared`(Prisma 스키마/클라이언트와 job payload용 TypeScript 인터페이스 몇 개)만 공유하도록 만든 이유도 여기에 있습니다. 지금 당장 두 개의 `node` 프로세스로 실행하기 위해 꼭 필요한 구조는 아니지만, 이 경계가 코드상에 먼저 존재해야만 나중에 두 개의 Docker 이미지가 되고, 이어서 워커의 Deployment에만 BullMQ 큐 길이를 기준으로 하는 `HorizontalPodAutoscaler`가 붙는 두 개의 Kubernetes Deployment로 이어질 수 있습니다.

## 재시도 동작

스크래핑 job은 BullMQ 내장 기능인 `attempts: 3`, `backoff: { type: 'exponential', delay: 2000 }` 옵션으로 큐에 들어갑니다. 매 시도마다(시도 횟수, 결과, 실패 시 에러 내용까지) 로그를 남기므로, DB에 남는 최종 상태뿐 아니라 재시도 이력 전체를 구조화된 로그에서 확인할 수 있습니다. 세 번째 시도까지 실패해야 워커가 비로소 `status=failed`와 에러 메시지를 저장하며, 그 사이 시도들 사이에는 BullMQ가 백오프 대기 시간 동안 job을 delayed 상태로 보류하는 동안 링크는 `processing` 상태로 유지됩니다.

## 관측성(Observability) 훅

두 프로세스 모두 독립적으로 스크랩/조회될 수 있도록 만들어졌는데, 이는 나중에 별도의 Kubernetes 파드로 돌아갈 때 중요해집니다:

- `GET /health`(API 전용)는 `@nestjs/terminus`로 DB와 Redis 연결을 각각 확인하므로, 어떤 의존성이 죽었는지를 API 프로세스 자체의 장애와 구분할 수 있습니다.
- `GET /metrics`는 워커가 API를 거쳐 보고하는 방식이 아니라 **두 프로세스 모두**에 존재합니다(API는 자신의 메인 포트에, 워커는 별도 포트인 기본값 `9100`에). 워커가 여러 개로 늘어나면 각 워커 레플리카를 개별 Prometheus 타겟으로 스크랩해야 하기 때문입니다.
- 모든 로그는 `timestamp`, `level`, `service`, `message`와 관련 ID(`linkId`, 재시도 횟수)를 담은 JSON이라, 별도의 파싱 단계 없이 로그 수집기(Loki, CloudWatch 등)로 바로 보낼 수 있습니다.

## 데이터 모델

정확한 스키마는 [`backend/shared/prisma/schema.prisma`](../backend/shared/prisma/schema.prisma)를 참고하세요. `links`, `tags`, 그리고 조인 테이블 `link_tags`는 프로젝트 기획서의 스키마를 그대로 매핑한 것입니다. `LinkStatus` enum(`pending`/`processing`/`completed`/`failed`)은 Prisma가 생성하며, `backend/shared`를 통해 API와 워커가 공유하므로 양쪽이 문자열 리터럴을 관례로 맞추는 대신 동일한 타입을 사용합니다.

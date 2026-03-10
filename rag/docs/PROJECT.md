# RAG 프로젝트 상세 문서

> 산업용 장비(AGV/OHT) 센서 텔레메트리 데이터에 대한 RAG(Retrieval-Augmented Generation) 시스템

## 1. 프로젝트 개요

### 목적
산업 현장의 AGV(무인운반차)와 OHT(천장 반송 시스템) 장비에서 수집된 센서 데이터를 벡터 임베딩으로 저장하고, 자연어 질문에 대해 **벡터 유사도 검색** 또는 **SQL 기반 정형 쿼리**를 통해 답변을 생성하는 시스템.

### 기술 스택
| 구분 | 기술 |
|------|------|
| **Runtime** | Bun (데이터 인제스트), Node.js (NestJS 서버) |
| **Framework** | NestJS v11 |
| **Language** | TypeScript 5.x |
| **Database** | PostgreSQL 18 + pgvector 0.8.2 |
| **ORM** | Drizzle ORM 0.45 |
| **Embedding Model** | BGE-M3 (Ollama, 1024차원) |
| **LLM** | OpenAI GPT-4o-mini |
| **Infra** | Docker Compose |

---

## 2. 아키텍처

### 전체 흐름

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  JSON 파일   │────▶│  Ingest CLI  │────▶│  PostgreSQL +   │
│  (센서 데이터) │     │  (Bun 실행)   │     │  pgvector       │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                    ┌──────────────┐                │
                    │  NestJS API  │◀───────────────┘
                    │  Server      │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
     ┌─────────────────┐    ┌────────────────────┐
     │  Vector Search   │    │  Agent (SQL) Query  │
     │  POST /query     │    │  POST /query/agent  │
     └────────┬────────┘    └────────┬───────────┘
              │                      │
              ▼                      ▼
     ┌─────────────────┐    ┌────────────────────┐
     │  Ollama (BGE-M3) │    │  LLM 기반 4단계     │
     │  질문 임베딩      │    │  파이프라인           │
     │  + pgvector 검색  │    │                    │
     └────────┬────────┘    └────────┬───────────┘
              │                      │
              ▼                      ▼
     ┌─────────────────────────────────────────┐
     │         OpenAI GPT-4o-mini              │
     │         (답변 생성)                      │
     └─────────────────────────────────────────┘
```

### NestJS 모듈 구조

```
AppModule
├── ConfigModule          (전역 설정)
├── DatabaseModule        (Drizzle + PostgreSQL, @Global)
├── EmbeddingModule       (Ollama BGE-M3 임베딩)
├── LLMModule             (OpenAI GPT-4o-mini)
├── EventModule           (데이터 인제스트)
└── QueryModule           (질의 API)
    ├── QueryService           (벡터 유사도 검색)
    ├── AgentQueryService      (에이전트 오케스트레이터)
    ├── QuestionAnalyzerService (질문 의도 분석)
    ├── SqlGeneratorService    (SQL 생성)
    └── SqlValidatorService    (SQL 검증 및 실행)
```

---

## 3. 데이터베이스 스키마

### 3.1 `event_store` — 이벤트 소싱 원본 저장소

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGSERIAL PK | 자동 증가 ID |
| `event_type` | VARCHAR(50) | 이벤트 유형 (기본: `sensor_reading`) |
| `device_id` | VARCHAR(50) | 장비 ID (예: `agv01`, `oht16`) |
| `device_type` | VARCHAR(10) | `agv` 또는 `oht` |
| `collected_at` | TIMESTAMP | 센서 수집 시각 |
| `payload` | JSONB | 원본 JSON 전체 |
| `source_file` | VARCHAR(255) UNIQUE | 중복 적재 방지용 파일명 |
| `created_at` | TIMESTAMP | 레코드 생성 시각 |

### 3.2 `read_model` — 정형화된 읽기 모델 (CQRS 패턴)

센서 값을 컬럼 단위로 펼쳐 SQL 집계/필터링에 최적화.

| 컬럼 그룹 | 컬럼 | 설명 |
|-----------|------|------|
| **기본 정보** | `device_id`, `device_type`, `device_manufacturer`, `device_name` | 장비 식별 |
| **설치 정보** | `installation_environment`, `location` | 테스트베드/현장, 물리 위치 |
| **먼지 센서** | `pm10`, `pm25`, `pm1_0` | 미세먼지 수치 (µg/m³) |
| **온도 센서** | `ntc_temp` | NTC 내부 온도 (℃) |
| **전류 센서** | `ct1`, `ct2`, `ct3`, `ct4` | 4채널 전류 (A) |
| **IR 열화상** | `ir_temp_max`, `ir_temp_max_x`, `ir_temp_max_y` | 최대 온도 및 좌표 |
| **상태** | `state` | 0=정상, 1=경고, 2=이상 |
| **외부 환경** | `ext_temperature`, `ext_humidity`, `ext_illuminance` | 외부 온습도, 조도 |
| **운영** | `cumulative_op_days`, `equipment_history` | 누적 가동일, 이력 횟수 |

### 3.3 `embeddings` — 벡터 임베딩 저장소

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGSERIAL PK | 자동 증가 ID |
| `event_id` | BIGINT FK → event_store | 원본 이벤트 참조 |
| `device_id` | VARCHAR(50) | 장비 ID |
| `content` | TEXT | 임베딩 원본 텍스트 (자연어 요약) |
| `embedding` | vector(1024) | BGE-M3 출력 벡터 |
| `metadata` | JSONB | 필터링용 메타 (device_type, state, collected_at 등) |
| `created_at` | TIMESTAMP | 생성 시각 |

**인덱스**: HNSW 코사인 유사도 인덱스 (`m=16`, `ef_construction=64`)

---

## 4. 핵심 기능 상세

### 4.1 데이터 인제스트 (`src/cli/ingest.ts`)

Bun 런타임으로 실행하는 CLI 스크립트. `./data/` 디렉토리의 JSON 파일을 배치 처리.

**처리 흐름:**
1. `Bun.Glob("**/*.json")`으로 데이터 파일 스캔
2. 50개 단위 배치로 병렬 처리 (`Promise.allSettled`)
3. 각 파일에 대해 `EventService.ingestFile()` 호출

**EventService.ingestFile() 내부 동작:**
1. JSON 파싱 → `source_file` 기준 중복 체크
2. `event_store` 테이블에 원본 JSON 저장 (이벤트 소싱)
3. `read_model` 테이블에 정형화된 센서 값 저장 (CQRS)
4. `TextBuilderService`로 자연어 텍스트 생성
5. Ollama BGE-M3로 1024차원 벡터 임베딩
6. `embeddings` 테이블에 벡터 저장

**데이터 규모:** 303개 디렉토리, 약 99,476개 JSON 파일

### 4.2 텍스트 빌더 (`src/embedding/text-builder.service.ts`)

센서 데이터를 벡터 검색에 적합한 자연어 문서로 변환.

**생성 텍스트 예시:**
```
[맥락] 이 데이터는 테스트베드 환경에서 설치된 AGV 유형 산업용 장비 agv01(제조사: B, 모델: B1)의
09-01 08:12:40 시점 센서 텔레메트리 기록임. 장비 위치는 agv/01/agv01_0901_0812이며,
누적 가동 13일차. 장비 7회 이력이 있는 장비의 상태는 "정상"으로 판정되었음
미세먼지: PM10=50µg/m³, PM2.5=32µg/m³, PM1.0=22µg/m³. 내부온도: NTC=29℃.
전류: CT1=1.75A, CT2=74.58A, CT3=48.99A, CT4=18.99A.
IR 열화상 최대온도: 44.38℃ (좌표: 120, 15).
외부환경: 온도=25℃, 습도=27%, 조도=155lux.
```

### 4.3 벡터 검색 쿼리 (`POST /query`)

**요청:**
```json
{
  "question": "agv01 장비의 온도가 높은 경우는?",
  "deviceId": "agv01",   // optional: 특정 장비 필터
  "topK": 5              // optional: 반환할 유사 문서 수 (기본 5)
}
```

**처리 파이프라인:**
1. 질문 텍스트를 Ollama BGE-M3로 임베딩 (1024차원)
2. pgvector 코사인 유사도(`<=>` 연산자)로 가장 유사한 문서 검색
3. 검색된 문서를 컨텍스트로 조립
4. GPT-4o-mini에 시스템 프롬프트 + 컨텍스트 + 질문 전달
5. 답변 생성 및 소스(eventId, deviceId, similarity) 반환

### 4.4 에이전트 SQL 쿼리 (`POST /query/agent`)

LLM 기반 4단계 에이전트 파이프라인으로 정형 데이터 질문에 대응.

**요청:**
```json
{
  "question": "경고 상태인 장비는 총 몇 대인가요?"
}
```

**4단계 파이프라인:**

| 단계 | Agent | 역할 | 클래스 |
|------|-------|------|--------|
| 1 | QuestionAnalyzer | 질문 의도 분석, SQL 필요 여부 판단 | `QuestionAnalyzerService` |
| 2 | SqlGenerator | 스키마 정보 기반 SELECT 쿼리 생성 | `SqlGeneratorService` |
| 3 | SqlValidator | SQL Injection 방지, 화이트리스트 테이블 검증, LIMIT 강제 | `SqlValidatorService` |
| 4 | AnswerGenerator | SQL 실행 결과 기반 자연어 답변 생성 | `AgentQueryService` 내부 |

**라우팅 로직:**
- `needsSql=true` → SQL 파이프라인 실행
- `needsSql=false` → 벡터 검색(`QueryService.ask()`)으로 위임
- SQL 검증 실패 또는 실행 오류 시 → 벡터 검색으로 **fallback**

**SQL 검증 규칙:**
- SELECT 문만 허용
- `INSERT`, `UPDATE`, `DELETE`, `DROP` 등 위험 키워드 차단
- `read_model` 테이블만 허용 (화이트리스트)
- LIMIT 없으면 자동 추가 (기본 50)
- 실행 오류 시 최대 2회 LLM을 통한 SQL 자동 수정 재시도

**응답 구조:**
```typescript
interface AgentQueryResponse {
  answer: string;                // 자연어 답변
  intent: "SQL" | "VECTOR";     // 사용된 쿼리 전략
  sql?: string;                 // 실행된 SQL (SQL 모드일 때)
  data?: unknown;               // SQL 조회 결과
  sources?: Array<{             // 벡터 검색 소스 (VECTOR 모드일 때)
    eventId: number;
    deviceId: string;
    similarity: number;
  }>;
}
```

---

## 5. 인프라 구성 (Docker Compose)

```yaml
services:
  pg-vector:      # pgvector/pgvector:0.8.2-pg18-trixie (Port: 1234)
  ollama:         # ollama/ollama:0.17.7 (Port: 21434, 모델: bge-m3 자동 pull)
```

- PostgreSQL은 `init.sql`로 테이블 + pgvector 확장 + HNSW 인덱스 자동 생성
- Ollama는 시작 시 bge-m3 모델 자동 다운로드

---

## 6. 프로젝트 구조

```
rag/
├── docker/
│   ├── docker-compose.yaml      # PostgreSQL + Ollama 컨테이너
│   ├── init.sql                 # DB 스키마 초기화 (pgvector, HNSW)
│   ├── pg-data/                 # PostgreSQL 데이터 볼륨
│   └── ollama-data/             # Ollama 모델 볼륨
├── data/                        # 센서 JSON 데이터 (약 99,476 파일)
│   ├── TL_agv_01_agv01_*/       # AGV 장비 데이터
│   └── TL_agv_02_agv02_*/       # ...
├── drizzle/                     # Drizzle 마이그레이션
├── src/
│   ├── main.ts                  # NestJS 부트스트랩 (포트 3000)
│   ├── app.module.ts            # 루트 모듈
│   ├── config/
│   │   └── configuration.ts     # 환경변수 설정 (database, ollama, openai)
│   ├── database/
│   │   ├── database.module.ts   # @Global Drizzle 모듈
│   │   ├── database.provider.ts # Drizzle + pg Pool 팩토리
│   │   └── schema/
│   │       ├── index.ts
│   │       ├── event-store.schema.ts
│   │       ├── read-model.schema.ts
│   │       └── embedding.schema.ts  # pgvector 커스텀 타입 포함
│   ├── embedding/
│   │   ├── embedding.module.ts
│   │   ├── embedding.service.ts     # Ollama API 호출 (embed, embedBatch)
│   │   └── text-builder.service.ts  # 센서 데이터 → 자연어 텍스트 변환
│   ├── event/
│   │   ├── event.module.ts
│   │   ├── event.service.ts         # 파일 인제스트 (3테이블 동시 삽입)
│   │   └── dto/
│   │       └── sensor-event.dto.ts  # 센서 JSON 타입 정의
│   ├── llm/
│   │   ├── llm.module.ts
│   │   └── llm.service.ts          # OpenAI Chat Completions 래퍼
│   ├── query/
│   │   ├── query.module.ts
│   │   ├── query.controller.ts     # POST /query, POST /query/agent
│   │   ├── query.service.ts        # 벡터 유사도 검색 + LLM 답변
│   │   ├── dto/
│   │   │   └── agent-query.dto.ts  # Agent 관련 DTO/인터페이스
│   │   └── agent/
│   │       ├── agent-query.service.ts       # 에이전트 오케스트레이터
│   │       ├── question-analyzer.service.ts # 질문 의도 분석
│   │       ├── sql-generator.service.ts     # SQL 생성 (스키마 기반)
│   │       └── sql-validator.service.ts     # SQL 검증 + 재시도 실행
│   └── cli/
│       └── ingest.ts            # Bun CLI 데이터 인제스트 스크립트
├── .env                         # 환경 변수
├── drizzle.config.ts
├── nest-cli.json
├── package.json
└── tsconfig.json
```

---

## 7. 실행 방법

### 인프라 시작
```bash
cd docker && docker compose up -d
```

### 데이터 인제스트
```bash
bun run src/cli/ingest.ts [year]   # 기본 year=2024
```

### API 서버 시작
```bash
# 개발 모드
npm run start:dev

# 프로덕션 모드
npm run build && npm run start:prod
```

### API 호출 예시
```bash
# 벡터 검색
curl -X POST http://localhost:3000/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "agv01 장비의 온도 상태는?"}'

# 에이전트 SQL 쿼리
curl -X POST http://localhost:3000/query/agent \
  -H 'Content-Type: application/json' \
  -d '{"question": "경고 상태인 장비는 총 몇 대인가요?"}'
```

---

## 8. 설계 특징

### Event Sourcing + CQRS
- `event_store`: 원본 JSON을 불변(immutable)하게 저장 (이벤트 소싱)
- `read_model`: 쿼리에 최적화된 비정규화 뷰 (CQRS 읽기 모델)
- 이벤트 → 읽기 모델 → 임베딩 3단계 프로젝션

### Hybrid RAG (벡터 + SQL)
- 비정형 질문 → **벡터 유사도 검색** (의미 기반)
- 정형 질문 (집계, 필터, 비교) → **LLM-generated SQL** (정확한 수치)
- 실패 시 자동 fallback 전략

### 보안
- SQL 화이트리스트 검증 (SELECT-only, read_model-only)
- 위험 키워드 정규식 차단
- 자동 LIMIT 강제 부여

### 임베딩 전략
- BGE-M3: 다국어(한국어 포함) 지원, 1024차원
- HNSW 인덱스: 근사 최근접 이웃 검색으로 고속 유사도 검색
- 자연어 컨텍스트 텍스트 구성으로 검색 품질 향상

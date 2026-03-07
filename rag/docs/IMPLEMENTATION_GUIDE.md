# RAG System 구현 가이드

산업용 AGV/OHT 센서 텔레메트리 데이터를 EventStore에 저장하고, CQRS 패턴으로 Read Model과 Vector Embeddings를 분리하여 RAG 기반 질의응답 시스템을 구축한다.

## 기술 스택

| 항목 | 기술 |
|------|------|
| Runtime | Bun |
| Framework | NestJS 11 |
| ORM | Drizzle ORM |
| Database | PostgreSQL + pgvector |
| Embedding | Ollama + BAAI/bge-m3 (1024차원) |
| LLM | OpenAI API (gpt-4o) |

---

## 전체 아키텍처

```
[JSON Files] → [EventService] → [event_store 테이블] (Write)
                     ↓
              [TextBuilderService] → 맥락(Context) + 센서 데이터 → 자연어 텍스트 생성
                     ↓
              [EmbeddingService] → Ollama bge-m3 → [embeddings 테이블]
                     ↓
              [read_model 테이블] (플래트닝된 센서 데이터 + 설치환경/위치)

[사용자 질문] → [EmbeddingService] → 질문 임베딩
                     ↓
              [pgvector 코사인 유사도 검색]
                     ↓
              [LlmService] → OpenAI (컨텍스트 + 질문) → 답변
```

> **Contextual Retrieval 전략**: 센서 데이터를 임베딩할 때, 각 데이터 조각 앞에 "이 데이터는 어떤 장비의 어떤 환경에서 수집된 것인지" 맥락 설명을 붙여 저장한다. 단순 수치 나열 대비 의미 기반 검색 정확도가 크게 향상된다.

---

## Step 1. 프로젝트 마이그레이션 (pnpm → Bun)

```bash
# pnpm 관련 파일 제거
rm pnpm-lock.yaml

# Bun으로 의존성 설치
bun install

# 필요한 패키지 추가
bun add @nestjs/config drizzle-orm postgres openai
bun add -d drizzle-kit bun-types
```

> **Drizzle 선택 이유**: TypeORM 대비 가볍고, 스키마를 TypeScript로 정의하며, pgvector 커스텀 타입을 깔끔하게 지원. NestJS와도 수동 주입으로 간단히 통합 가능.

### package.json 스크립트 수정

```jsonc
{
  "scripts": {
    "build": "nest build",
    "start": "bun run src/main.ts",
    "start:dev": "bun --watch run src/main.ts",
    "start:debug": "bun --inspect run src/main.ts",
    "start:prod": "bun run dist/main.js",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "bun test",
    "ingest": "bun run src/cli/ingest.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  }
}
```

---

## Step 2. Docker 설정

### docker/docker-compose.yaml

기존 pg-vector 서비스에 Ollama 추가:

```yaml
name: simple-rag

services:
  pg-vector:
    image: pgvector/pgvector:0.8.2-pg18-trixie
    container_name: vectordb
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-postgres}
    ports:
      - "1234:5432"
    volumes:
      - ./pg-data:/var/lib/postgresql
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 3

  ollama:
    image: ollama/ollama:latest
    container_name: ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama

volumes:
  ollama-data:
    driver: local
```

> **macOS 참고**: Docker에서는 GPU 패스스루가 안 됨. 성능을 위해 `brew install ollama && ollama serve`로 네이티브 실행 권장.

### 실행

```bash
cd docker
docker compose up -d

# bge-m3 모델 다운로드
docker exec ollama ollama pull bge-m3
```

### docker/init.sql

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================
-- 1. Event Store (Write Model)
-- 원본 JSON을 그대로 JSONB로 저장하는 이벤트 로그
-- =============================================
CREATE TABLE IF NOT EXISTS event_store (
    id            BIGSERIAL PRIMARY KEY,
    event_type    VARCHAR(50) NOT NULL DEFAULT 'sensor_reading',
    device_id     VARCHAR(50) NOT NULL,
    device_type   VARCHAR(10) NOT NULL,       -- 'agv' or 'oht'
    collected_at  TIMESTAMP NOT NULL,
    payload       JSONB NOT NULL,             -- 원본 JSON 전체
    source_file   VARCHAR(255) NOT NULL UNIQUE, -- 중복 적재 방지
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_store_device_id ON event_store(device_id);
CREATE INDEX IF NOT EXISTS idx_event_store_collected_at ON event_store(collected_at);
CREATE INDEX IF NOT EXISTS idx_event_store_device_type ON event_store(device_type);

-- =============================================
-- 2. Read Model
-- 센서 데이터를 플래트닝하여 조회 최적화
-- =============================================
CREATE TABLE IF NOT EXISTS read_model (
    id                        BIGSERIAL PRIMARY KEY,
    event_id                  BIGINT NOT NULL REFERENCES event_store(id),
    device_id                 VARCHAR(50) NOT NULL,
    device_type               VARCHAR(10) NOT NULL,
    device_manufacturer       VARCHAR(50),
    device_name               VARCHAR(50),
    installation_environment  VARCHAR(50),          -- 설치환경 ('테스트베드', '현장' 등)
    location                  VARCHAR(100),         -- 물리적 위치 ('agv/01/agv01_0901_0812')
    collected_at              TIMESTAMP NOT NULL,
    -- 먼지 센서
    pm10                      REAL,
    pm25                      REAL,
    pm1_0                     REAL,                 -- PM1.0 (초미세먼지)
    -- 온도 센서
    ntc_temp                  REAL,
    -- 전류 센서
    ct1                       REAL,
    ct2                       REAL,
    ct3                       REAL,
    ct4                       REAL,
    -- IR 열화상
    ir_temp_max               REAL,
    ir_temp_max_x             REAL,
    ir_temp_max_y             REAL,
    -- 어노테이션 (0=정상, 1=경고, 2=이상)
    state                     SMALLINT NOT NULL DEFAULT 0,
    -- 외부 환경
    ext_temperature           REAL,
    ext_humidity              REAL,
    ext_illuminance           REAL,
    -- 메타데이터
    cumulative_op_days        INT,
    equipment_history         INT,
    created_at                TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_read_model_device_id ON read_model(device_id);
CREATE INDEX IF NOT EXISTS idx_read_model_collected_at ON read_model(collected_at);
CREATE INDEX IF NOT EXISTS idx_read_model_state ON read_model(state);

-- =============================================
-- 3. Embeddings (Vector Store for RAG)
-- bge-m3 임베딩 저장 (1024차원)
-- =============================================
CREATE TABLE IF NOT EXISTS embeddings (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT NOT NULL REFERENCES event_store(id),
    device_id     VARCHAR(50) NOT NULL,
    content       TEXT NOT NULL,              -- 임베딩된 원본 텍스트
    embedding     vector(1024) NOT NULL,      -- bge-m3 출력 벡터
    metadata      JSONB,                      -- 필터링용 메타데이터
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- HNSW 인덱스 (코사인 유사도, bge-m3에 최적)
CREATE INDEX IF NOT EXISTS idx_embeddings_cosine ON embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_embeddings_device_id ON embeddings(device_id);
```

---

## Step 3. 환경 변수 설정

### .env (프로젝트 루트)

Bun이 자동으로 `.env`를 로드하므로 dotenv 불필요.

```env
DB_HOST=localhost
DB_PORT=1234
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=postgres

OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=bge-m3

OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4o
```

---

## Step 4. NestJS 모듈 구조

### 디렉토리 구조

```
src/
├── main.ts
├── app.module.ts
├── config/
│   └── configuration.ts
├── database/
│   ├── database.module.ts            # Drizzle 연결 + Provider
│   ├── database.provider.ts          # postgres 클라이언트 + drizzle 인스턴스
│   └── schema/
│       ├── index.ts                  # 모든 스키마 re-export
│       ├── event-store.schema.ts
│       ├── read-model.schema.ts
│       └── embeddings.schema.ts
├── event/                            # Write Side
│   ├── event.module.ts
│   ├── event.service.ts
│   └── dto/
│       └── sensor-event.dto.ts
├── embedding/
│   ├── embedding.module.ts
│   ├── embedding.service.ts          # Ollama API 호출
│   └── text-builder.service.ts       # JSON → 자연어 변환
├── llm/
│   ├── llm.module.ts
│   └── llm.service.ts                # OpenAI 호출
├── query/                            # Read Side (RAG)
│   ├── query.module.ts
│   ├── query.service.ts              # RAG 오케스트레이션
│   └── query.controller.ts           # POST /query
├── cli/
│   └── ingest.ts                     # 배치 적재 스크립트
└── drizzle.config.ts                 # Drizzle Kit 설정
```

---

## Step 5. 구현 상세

### 5-1. Drizzle 설정

**`drizzle.config.ts`** (프로젝트 루트)

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '1234', 10),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'postgres',
  },
});
```

### 5-2. 설정 모듈

**`src/config/configuration.ts`**

```typescript
export default () => ({
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '1234', 10),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'postgres',
  },
  ollama: {
    baseUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL ?? 'bge-m3',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o',
  },
});
```

### 5-3. Drizzle 스키마 정의

**`src/database/schema/event-store.schema.ts`**

```typescript
import {
  pgTable,
  bigserial,
  varchar,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';

export const eventStore = pgTable('event_store', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventType: varchar('event_type', { length: 50 }).notNull().default('sensor_reading'),
  deviceId: varchar('device_id', { length: 50 }).notNull(),
  deviceType: varchar('device_type', { length: 10 }).notNull(),
  collectedAt: timestamp('collected_at').notNull(),
  payload: jsonb('payload').notNull(),
  sourceFile: varchar('source_file', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type EventStoreInsert = typeof eventStore.$inferInsert;
export type EventStoreSelect = typeof eventStore.$inferSelect;
```

**`src/database/schema/read-model.schema.ts`**

```typescript
import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  real,
  smallint,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';
import { eventStore } from './event-store.schema';

export const readModel = pgTable('read_model', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventId: bigint('event_id', { mode: 'number' }).notNull().references(() => eventStore.id),
  deviceId: varchar('device_id', { length: 50 }).notNull(),
  deviceType: varchar('device_type', { length: 10 }).notNull(),
  deviceManufacturer: varchar('device_manufacturer', { length: 50 }),
  deviceName: varchar('device_name', { length: 50 }),
  installationEnvironment: varchar('installation_environment', { length: 50 }),
  location: varchar('location', { length: 100 }),
  collectedAt: timestamp('collected_at').notNull(),
  // 먼지 센서
  pm10: real('pm10'),
  pm25: real('pm25'),
  pm1_0: real('pm1_0'),
  // 온도 센서
  ntcTemp: real('ntc_temp'),
  // 전류 센서
  ct1: real('ct1'),
  ct2: real('ct2'),
  ct3: real('ct3'),
  ct4: real('ct4'),
  // IR 열화상
  irTempMax: real('ir_temp_max'),
  irTempMaxX: real('ir_temp_max_x'),
  irTempMaxY: real('ir_temp_max_y'),
  // 어노테이션 (0=정상, 1=경고, 2=이상)
  state: smallint('state').notNull().default(0),
  // 외부 환경
  extTemperature: real('ext_temperature'),
  extHumidity: real('ext_humidity'),
  extIlluminance: real('ext_illuminance'),
  // 메타데이터
  cumulativeOpDays: integer('cumulative_op_days'),
  equipmentHistory: integer('equipment_history'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type ReadModelInsert = typeof readModel.$inferInsert;
export type ReadModelSelect = typeof readModel.$inferSelect;
```

**`src/database/schema/embeddings.schema.ts`**

```typescript
import {
  pgTable,
  bigserial,
  bigint,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { eventStore } from './event-store.schema';

// pgvector 커스텀 타입 정의
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1024)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(',')
      .map(Number);
  },
});

export const embeddings = pgTable(
  'embeddings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: bigint('event_id', { mode: 'number' }).notNull().references(() => eventStore.id),
    deviceId: varchar('device_id', { length: 50 }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_embeddings_device_id').on(table.deviceId),
    // HNSW 인덱스는 init.sql에서 생성 (Drizzle이 HNSW 구문을 지원하지 않음)
  ],
);

export type EmbeddingsInsert = typeof embeddings.$inferInsert;
export type EmbeddingsSelect = typeof embeddings.$inferSelect;
```

**`src/database/schema/index.ts`**

```typescript
export { eventStore, type EventStoreInsert, type EventStoreSelect } from './event-store.schema';
export { readModel, type ReadModelInsert, type ReadModelSelect } from './read-model.schema';
export { embeddings, type EmbeddingsInsert, type EmbeddingsSelect } from './embeddings.schema';
```

### 5-4. 데이터베이스 모듈 (Drizzle + NestJS 통합)

**`src/database/database.provider.ts`**

```typescript
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');

export type DrizzleDB = NodePgDatabase<typeof schema>;

export const drizzleProvider = {
  provide: DRIZZLE,
  useFactory: async () => {
    const pool = new Pool({
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '1234', 10),
      user: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: process.env.DB_NAME ?? 'postgres',
    });
    return drizzle(pool, { schema });
  },
};
```

> **참고**: `postgres` (postgres.js) 대신 `pg` (node-postgres)를 사용한다. Drizzle은 둘 다 지원하지만, `pg`의 `Pool`이 커넥션 풀 관리에 더 성숙하고 NestJS 생태계와 호환성이 좋다.
>
> 만약 `postgres` (postgres.js)를 사용하고 싶다면:
> ```typescript
> import { drizzle } from 'drizzle-orm/postgres-js';
> import postgres from 'postgres';
>
> const client = postgres({ host, port, user, password, database });
> return drizzle(client, { schema });
> ```
> 이 경우 `bun add postgres`로 패키지를 변경하면 된다.

**`src/database/database.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { drizzleProvider } from './database.provider';

@Global()
@Module({
  providers: [drizzleProvider],
  exports: [drizzleProvider],
})
export class DatabaseModule {}
```

### 5-5. DTO (JSON 구조 타입)

**`src/event/dto/sensor-event.dto.ts`**

```typescript
export interface SensorEventJson {
  meta_info: MetaInfo[];
  sensor_data: SensorData[];
  ir_data: IrData[];
  annotations: Annotation[];
  external_data: ExternalData[];
}

export interface MetaInfo {
  device_id: string;
  device_manufacturer: string;
  device_name: string;
  dust_sensor_manufacturer: string;
  dust_sensor_name: string;
  temp_sensor_manufacturer: string;
  temp_sensor_name: string;
  overcurrent_sensor_manufacturer: string;
  overcurrent_sensor_name: string;
  thermal_camera_sensor_manufacturer: string;
  thermal_camera_sensor_name: string;
  installation_environment: string;
  collection_date: string;          // "08-27"
  collection_time: string;          // "00:05:57"
  duration_time: string;
  sensor_types: string;
  cumulative_operating_day: string;
  equipment_history: string;
  'img-id': string;
  location: string;
  filename: string;
  img_name: string;
  img_description: string;
}

interface SensorValue {
  data_unit: string;
  value: number;
  trend: string;
}

export interface SensorData {
  PM10: SensorValue[];
  'PM2.5': SensorValue[];
  'PM1.0': SensorValue[];
  NTC: SensorValue[];
  CT1: SensorValue[];
  CT2: SensorValue[];
  CT3: SensorValue[];
  CT4: SensorValue[];
}

export interface IrData {
  temp_max: Array<{
    value_TGmx: number;
    X_Tmax: number;
    Y_Tmax: number;
  }>;
}

export interface Annotation {
  tagging: Array<{
    annotation_type: string;
    state: string; // "0"=정상, "1"=경고, "2"=이상
  }>;
}

export interface ExternalData {
  ex_temperature: SensorValue[];
  ex_humidity: SensorValue[];
  ex_illuminance: SensorValue[];
}
```

### 5-6. Embedding 모듈

**`src/embedding/embedding.service.ts`** - Ollama HTTP API 호출

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmbeddingService {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('ollama.baseUrl')!;
    this.model = config.get<string>('ollama.model')!;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings;
  }
}
```

**`src/embedding/text-builder.service.ts`** - JSON을 **맥락 포함 자연어 텍스트**로 변환

이 서비스가 RAG 품질을 결정하는 핵심. **Contextual Retrieval** 기법을 적용하여, 센서 데이터를 단순 나열하는 것이 아니라 "이 데이터가 전체 데이터셋에서 어떤 위치에 있는지" 맥락 설명을 앞에 붙인다.

> **RAG 저장 전략**: 문서(센서 데이터)를 저장할 때, 각 조각이 전체 데이터셋에서 어떤 맥락인지 설명을 함께 저장한다. 이를 통해 벡터 검색 시 단순 수치 매칭이 아닌, 의미 기반 검색 정확도를 높인다.

```typescript
import { Injectable } from '@nestjs/common';
import type { MetaInfo, SensorData, IrData, Annotation, ExternalData } from '../event/dto/sensor-event.dto';

@Injectable()
export class TextBuilderService {
  build(
    meta: MetaInfo,
    sensors: SensorData,
    ir: IrData,
    annotation: Annotation,
    external: ExternalData,
  ): string {
    const state = annotation.tagging[0].state;
    const stateLabel = state === '0' ? '정상' : state === '1' ? '경고' : '이상';
    const deviceType = meta.device_id.replace(/\d+/g, '').toUpperCase();

    // --- 맥락 설명 (Contextual Prefix) ---
    // 이 조각이 전체 데이터셋에서 어떤 위치에 있는지 설명
    const contextPrefix = [
      `[맥락] 이 데이터는 ${meta.installation_environment} 환경에 설치된`,
      `${deviceType} 유형 산업용 장비 ${meta.device_id}(제조사: ${meta.device_manufacturer}, 모델: ${meta.device_name})의`,
      `${meta.collection_date} ${meta.collection_time} 시점 센서 텔레메트리 기록이다.`,
      `장비 위치는 ${meta.location}이며, 누적 가동 ${meta.cumulative_operating_day}일차,`,
      `정비 ${meta.equipment_history}회 이력이 있는 장비의 상태는 "${stateLabel}"으로 판정되었다.`,
    ].join(' ');

    // --- 센서 데이터 본문 ---
    const sensorBody = [
      `미세먼지: PM10=${sensors.PM10[0].value}µg/m³, PM2.5=${sensors['PM2.5'][0].value}µg/m³, PM1.0=${sensors['PM1.0'][0].value}µg/m³.`,
      `내부온도: NTC=${sensors.NTC[0].value}℃.`,
      `전류: CT1=${sensors.CT1[0].value}A, CT2=${sensors.CT2[0].value}A, CT3=${sensors.CT3[0].value}A, CT4=${sensors.CT4[0].value}A.`,
      `IR 열화상 최대온도: ${ir.temp_max[0].value_TGmx}℃ (좌표: ${ir.temp_max[0].X_Tmax}, ${ir.temp_max[0].Y_Tmax}).`,
      `외부환경: 온도=${external.ex_temperature[0].value}℃, 습도=${external.ex_humidity[0].value}%, 조도=${external.ex_illuminance[0].value}lux.`,
    ].join(' ');

    return `${contextPrefix}\n${sensorBody}`;
  }
}
```

생성되는 텍스트 예시:
> **[맥락 + 센서 데이터가 결합된 형태]**
>
> "[맥락] 이 데이터는 테스트베드 환경에 설치된 OHT 유형 산업용 장비 oht09(제조사: A, 모델: A1)의 08-27 00:05:57 시점 센서 텔레메트리 기록이다. 장비 위치는 oht/09/oht09_0827_0005이며, 누적 가동 18일차, 정비 13회 이력이 있는 장비의 상태는 "이상"으로 판정되었다.
> 미세먼지: PM10=20µg/m³, PM2.5=12µg/m³, PM1.0=8µg/m³. 내부온도: NTC=28.41℃. 전류: CT1=66.31A, CT2=1.56A, CT3=0.87A, CT4=0.72A. IR 열화상 최대온도: 71.77℃ (좌표: 12, 85). 외부환경: 온도=22℃, 습도=35%, 조도=528lux."
>
> 맥락 설명이 앞에 붙어 있어, 벡터 검색 시 "테스트베드에서 이상 상태인 OHT 장비" 같은 질문에도 높은 유사도를 얻을 수 있다.

**`src/embedding/embedding.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { TextBuilderService } from './text-builder.service';

@Module({
  providers: [EmbeddingService, TextBuilderService],
  exports: [EmbeddingService, TextBuilderService],
})
export class EmbeddingModule {}
```

### 5-7. Event 모듈 (Write Side)

**`src/event/event.service.ts`** - 데이터 적재 핵심 로직

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../database/database.provider';
import { eventStore, readModel, embeddings } from '../database/schema';
import { EmbeddingService } from '../embedding/embedding.service';
import { TextBuilderService } from '../embedding/text-builder.service';
import type { SensorEventJson } from './dto/sensor-event.dto';

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly embeddingService: EmbeddingService,
    private readonly textBuilder: TextBuilderService,
  ) {}

  async ingestFile(filePath: string, year = 2024): Promise<void> {
    const file = Bun.file(filePath);
    const json: SensorEventJson = await file.json();
    const meta = json.meta_info[0];
    const sourceFile = meta.filename;

    // 1. 중복 체크
    const existing = await this.db
      .select({ id: eventStore.id })
      .from(eventStore)
      .where(eq(eventStore.sourceFile, sourceFile))
      .limit(1);

    if (existing.length > 0) return;

    const collectedAt = this.parseDate(meta.collection_date, meta.collection_time, year);
    const deviceType = meta.device_id.replace(/\d+/g, '');

    // 2. event_store에 저장
    const [event] = await this.db
      .insert(eventStore)
      .values({
        eventType: 'sensor_reading',
        deviceId: meta.device_id,
        deviceType,
        collectedAt,
        payload: json,
        sourceFile,
      })
      .returning({ id: eventStore.id });

    // 3. read_model에 플래트닝하여 저장
    const sensors = json.sensor_data[0];
    const ir = json.ir_data[0];
    const annotation = json.annotations[0];
    const ext = json.external_data[0];

    await this.db.insert(readModel).values({
      eventId: event.id,
      deviceId: meta.device_id,
      deviceType,
      deviceManufacturer: meta.device_manufacturer,
      deviceName: meta.device_name,
      installationEnvironment: meta.installation_environment,
      location: meta.location,
      collectedAt,
      pm10: sensors.PM10[0].value,
      pm25: sensors['PM2.5'][0].value,
      pm1_0: sensors['PM1.0'][0].value,
      ntcTemp: sensors.NTC[0].value,
      ct1: sensors.CT1[0].value,
      ct2: sensors.CT2[0].value,
      ct3: sensors.CT3[0].value,
      ct4: sensors.CT4[0].value,
      irTempMax: ir.temp_max[0].value_TGmx,
      irTempMaxX: ir.temp_max[0].X_Tmax,
      irTempMaxY: ir.temp_max[0].Y_Tmax,
      state: parseInt(annotation.tagging[0].state, 10),
      extTemperature: ext.ex_temperature[0].value,
      extHumidity: ext.ex_humidity[0].value,
      extIlluminance: ext.ex_illuminance[0].value,
      cumulativeOpDays: parseInt(meta.cumulative_operating_day, 10),
      equipmentHistory: parseInt(meta.equipment_history, 10),
    });

    // 4. 맥락 포함 텍스트 생성 → 임베딩 → embeddings 테이블 저장
    const text = this.textBuilder.build(meta, sensors, ir, annotation, ext);
    const vector = await this.embeddingService.embed(text);

    await this.db.insert(embeddings).values({
      eventId: event.id,
      deviceId: meta.device_id,
      content: text,
      embedding: vector,
      metadata: {
        device_type: deviceType,
        state: annotation.tagging[0].state,
        collected_at: collectedAt.toISOString(),
        installation_environment: meta.installation_environment,
        location: meta.location,
      },
    });
  }

  private parseDate(dateStr: string, timeStr: string, year: number): Date {
    // dateStr = "08-27", timeStr = "00:05:57"
    const [month, day] = dateStr.split('-');
    return new Date(`${year}-${month}-${day}T${timeStr}`);
  }
}
```

> **Drizzle 장점**: `db.insert(readModel).values({...})`처럼 타입 안전하게 INSERT 가능. TypeORM의 raw SQL 대비 훨씬 깔끔하다. 특히 embeddings 테이블의 vector 컬럼도 커스텀 타입 덕분에 `embedding: vector` (number[])를 직접 전달할 수 있다.

**`src/event/event.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module';
import { EventService } from './event.service';

@Module({
  imports: [EmbeddingModule],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
```

### 5-8. 배치 적재 스크립트

**`src/cli/ingest.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { EventService } from '../event/event.service';
import { Glob } from 'bun';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const eventService = app.get(EventService);

  // 연도 파라미터: CLI 인자로 전달 가능 (기본값 2024)
  const year = parseInt(process.argv[2] ?? '2024', 10);

  const glob = new Glob('**/*.json');
  const dataDir = './data';
  const files: string[] = [];

  for await (const path of glob.scan({ cwd: dataDir, absolute: true })) {
    files.push(path);
  }

  console.log(`Found ${files.length} JSON files (year: ${year})`);

  const BATCH_SIZE = 50;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((f) => eventService.ingestFile(f, year)),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') success++;
      else {
        failed++;
        console.error('Failed:', result.reason);
      }
    }

    console.log(
      `Progress: ${Math.min(i + BATCH_SIZE, files.length)}/${files.length} (success: ${success}, failed: ${failed})`,
    );
  }

  console.log(`Done! Success: ${success}, Failed: ${failed}`);
  await app.close();
}

main();
```

실행:

```bash
# 기본 (2024년)
bun run src/cli/ingest.ts

# 연도 지정
bun run src/cli/ingest.ts 2025
```

### 5-9. LLM 모듈

**`src/llm/llm.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class LlmService {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.client = new OpenAI({ apiKey: config.get<string>('openai.apiKey') });
    this.model = config.get<string>('openai.model')!;
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
    });
    return response.choices[0].message.content ?? '';
  }
}
```

**`src/llm/llm.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';

@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
```

### 5-10. Query 모듈 (Read Side - RAG)

**`src/query/query.service.ts`**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../database/database.provider';
import { EmbeddingService } from '../embedding/embedding.service';
import { LlmService } from '../llm/llm.service';

interface SimilarityResult {
  id: number;
  event_id: number;
  device_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

@Injectable()
export class QueryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly embeddingService: EmbeddingService,
    private readonly llmService: LlmService,
  ) {}

  async ask(
    question: string,
    options?: { deviceId?: string; topK?: number },
  ) {
    const topK = options?.topK ?? 5;

    // 1. 질문 임베딩
    const queryVector = await this.embeddingService.embed(question);
    const vectorStr = `[${queryVector.join(',')}]`;

    // 2. pgvector 코사인 유사도 검색
    // Drizzle의 sql 템플릿으로 raw query 실행
    let results: SimilarityResult[];

    if (options?.deviceId) {
      results = await this.db.execute<SimilarityResult>(sql`
        SELECT id, event_id, device_id, content, metadata,
               1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM embeddings
        WHERE device_id = ${options.deviceId}
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT ${topK}
      `);
    } else {
      results = await this.db.execute<SimilarityResult>(sql`
        SELECT id, event_id, device_id, content, metadata,
               1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM embeddings
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT ${topK}
      `);
    }

    // 3. 컨텍스트 조립
    const context = results
      .map(
        (r, i) =>
          `[${i + 1}] (유사도: ${Number(r.similarity).toFixed(3)}) ${r.content}`,
      )
      .join('\n\n');

    // 4. LLM으로 답변 생성
    const systemPrompt = `당신은 산업용 AGV/OHT 센서 텔레메트리 데이터를 분석하는 전문가입니다.
제공된 컨텍스트에 기반해서만 질문에 답변하세요.
컨텍스트에 충분한 정보가 없으면 그렇다고 말하세요.
답변 시 참조한 레코드를 인용하세요 (예: [1], [2]).
사용자의 질문과 같은 언어로 답변하세요.`;

    const userMessage = `컨텍스트:\n${context}\n\n질문: ${question}`;

    const answer = await this.llmService.generate(systemPrompt, userMessage);

    return {
      answer,
      sources: results.map((r) => ({
        eventId: r.event_id,
        deviceId: r.device_id,
        similarity: Number(r.similarity),
      })),
    };
  }
}
```

> **Drizzle + pgvector**: 벡터 유사도 검색은 Drizzle의 `sql` 템플릿 리터럴로 수행한다. `sql\`...\`` 안에서 `${variable}`은 자동으로 파라미터화되어 SQL injection을 방지한다.

**`src/query/query.controller.ts`**

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { QueryService } from './query.service';

@Controller('query')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post()
  async ask(
    @Body() body: { question: string; deviceId?: string; topK?: number },
  ) {
    return this.queryService.ask(body.question, {
      deviceId: body.deviceId,
      topK: body.topK,
    });
  }
}
```

**`src/query/query.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module';
import { LlmModule } from '../llm/llm.module';
import { QueryService } from './query.service';
import { QueryController } from './query.controller';

@Module({
  imports: [EmbeddingModule, LlmModule],
  providers: [QueryService],
  controllers: [QueryController],
})
export class QueryModule {}
```

### 5-11. App Module 연결

**`src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { EventModule } from './event/event.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { LlmModule } from './llm/llm.module';
import { QueryModule } from './query/query.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    EventModule,
    EmbeddingModule,
    LlmModule,
    QueryModule,
  ],
})
export class AppModule {}
```

---

## Step 6. 실행 및 검증

### 6-1. 인프라 실행

```bash
cd docker
docker compose up -d

# Ollama bge-m3 모델 다운로드
docker exec ollama ollama pull bge-m3

# 또는 macOS 네이티브:
# ollama pull bge-m3
```

### 6-2. 데이터 적재

```bash
bun run src/cli/ingest.ts
```

### 6-3. 적재 확인

```bash
# Docker PostgreSQL 접속
docker exec -it vectordb psql -U postgres

# 각 테이블 row count 확인
SELECT COUNT(*) FROM event_store;
SELECT COUNT(*) FROM read_model;
SELECT COUNT(*) FROM embeddings;

# 샘플 데이터 확인
SELECT device_id, collected_at, state FROM read_model LIMIT 5;
SELECT device_id, LEFT(content, 100) FROM embeddings LIMIT 5;
```

### 6-4. RAG 서버 실행

```bash
bun run start:dev
```

### 6-5. RAG 질의 테스트

```bash
curl -X POST http://localhost:3000/query \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "oht09 장비에서 과전류가 발생한 적이 있나요?",
    "deviceId": "oht09",
    "topK": 5
  }'
```

---

## TypeORM 대비 Drizzle 차이점 요약

| 항목 | TypeORM | Drizzle |
|------|---------|---------|
| 스키마 정의 | 데코레이터 기반 Entity 클래스 | 함수 기반 테이블 정의 (`pgTable`) |
| NestJS 통합 | `@nestjs/typeorm` 공식 모듈 | 커스텀 Provider로 수동 주입 |
| pgvector 지원 | raw SQL 필수 | `customType`으로 타입 안전하게 처리 |
| INSERT 반환값 | `.save()` → 엔티티 객체 | `.returning()` → 선택한 컬럼만 |
| 쿼리 빌더 | QueryBuilder / Repository | 타입 안전 `select`, `insert`, `update` |
| vector INSERT | `DataSource.query()` raw SQL | `db.insert(embeddings).values({ embedding: vector })` |
| vector 검색 | raw SQL 필수 | `sql` 템플릿 (파라미터 자동 바인딩) |

---

## 주의사항

1. **Drizzle + pgvector HNSW 인덱스**: Drizzle Kit은 HNSW 인덱스 구문을 생성하지 못한다. 반드시 `init.sql`에서 수동으로 생성해야 한다.
2. **날짜 파싱**: JSON의 `collection_date`에 연도 없음. `ingestFile(filePath, year)` 및 CLI 인자(`bun run src/cli/ingest.ts 2024`)로 연도를 지정한다.
3. **macOS Ollama**: Docker에서 GPU 사용 불가. 개발 시 네이티브 Ollama가 Metal 가속으로 훨씬 빠름.
4. **적재 시간**: ~99,500 파일, 배치 50개 기준 약 10~30분 예상 (Ollama 성능에 따라 상이).
5. **멱등성**: `source_file` UNIQUE 제약으로 동일 파일 중복 적재 방지. 스크립트 재실행 안전.
6. **pg 패키지**: Drizzle에서 `node-postgres` (pg) 사용 시 `bun add pg @types/pg` 필요. 또는 `postgres` (postgres.js)로 대체 가능.
7. **Contextual RAG**: `TextBuilderService`에서 맥락 설명(장비 유형, 설치환경, 위치, 가동일수, 상태)을 데이터 앞에 붙여 저장한다. 이를 통해 "테스트베드의 이상 상태 OHT 장비" 같은 고수준 질의에도 높은 검색 정확도를 얻는다.
8. **컬럼명 `pm1_0`**: JSON의 `PM1.0`(초미세먼지 1.0µm)에 대응한다. 이전 `pm10_raw`에서 혼동을 방지하기 위해 변경됨.

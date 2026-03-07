CREATE
EXTENSION IF NOT EXISTS vector;

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

import {Injectable} from "@nestjs/common";
import {LLMService} from "@/llm/llm.service";
import {
  GeneratedSql,
  QuestionAnalysis,
}                   from "@/query/dto/agent-query.dto";

@Injectable()
export class SqlGeneratorService {
  private readonly SCHEMA_PROMPT = `사용 가능한 테이블 스키마:

TABLE: read_model
COLUMNS:
  id              BIGSERIAL PRIMARY KEY
  event_id        BIGINT NOT NULL       -- event_store 참조
  device_id       VARCHAR(50) NOT NULL  -- 장비 ID (예: 'oht01', 'agv16')
  device_type     VARCHAR(10) NOT NULL  -- 'agv' 또는 'oht'
  device_manufacturer VARCHAR(50)       -- 제조사
  device_name     VARCHAR(50)           -- 장비명
  installation_environment VARCHAR(50)  -- 설치환경 ('테스트베드', '현장' 등)
  location        VARCHAR(100)          -- 물리적 위치
  collected_at    TIMESTAMP NOT NULL    -- 센서 수집 시각
  -- 먼지 센서
  pm10            REAL                  -- PM10 미세먼지
  pm25            REAL                  -- PM2.5 초미세먼지
  pm1_0           REAL                  -- PM1.0
  -- 온도 센서
  ntc_temp        REAL                  -- NTC 온도
  -- 전류 센서
  ct1             REAL                  -- 전류 1
  ct2             REAL                  -- 전류 2
  ct3             REAL                  -- 전류 3
  ct4             REAL                  -- 전류 4
  -- IR 열화상
  ir_temp_max     REAL                  -- IR 최대 온도
  ir_temp_max_x   REAL                  -- IR 최대 온도 X좌표
  ir_temp_max_y   REAL                  -- IR 최대 온도 Y좌표
  -- 어노테이션
  state           SMALLINT NOT NULL DEFAULT 0  -- 0=정상, 1=경고, 2=이상
  -- 외부 환경
  ext_temperature REAL                  -- 외부 온도
  ext_humidity    REAL                  -- 외부 습도
  ext_illuminance REAL                  -- 외부 조도
  -- 메타데이터
  cumulative_op_days INT               -- 누적 운영 일수
  equipment_history  INT               -- 장비 이력
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()

INDEXES:
  idx_read_model_device_id    ON (device_id)
  idx_read_model_collected_at ON (collected_at)
  idx_read_model_state        ON (state)`;

  constructor(
    private readonly llmService: LLMService,
  ) {
  }

  async generate(
    question: string,
    analysis: QuestionAnalysis,
  ) {
    const systemPrompt: string = `당신은 PostgreSQL SQL 쿼리 전문가입니다.
사용자의 질문과 분석 결과를 바탕으로 정확한 SELECT 쿼리를 생성하세요.

${this.SCHEMA_PROMPT}

규칙:
- SELECT 문만 생성 (INSERT/UPDATE/DELETE/DROP 등 금지)
- read_model 테이블만 사용
- 결과가 많을 수 있으므로 적절한 LIMIT 포함 (기본 50, 집계 시 불필요)
- 날짜 비교 시 collected_at 컬럼 사용
- state 컬럼: 0=정상, 1=경고, 2=이상
- 존재하지 않는 컬럼은 사용하지 마세요

반드시 JSON만 응답하세요:
{
  "sql": "SELECT ...",
  "explanation": "이 쿼리가 하는 일에 대한 간단한 설명"
}`;

    const userMessage = `질문 ${question}
분석 결과: ${JSON.stringify(analysis, null, 2)}`;

    const response: string = await this.llmService.generate(systemPrompt, userMessage);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(`SQL 생성 실패: JSON 파싱 불가`);
      }
      return JSON.parse(jsonMatch[0]) as GeneratedSql;
    } catch (error) {
      throw new Error(`SQL 생성 실패: ${error.message}`);
    }
  }
}

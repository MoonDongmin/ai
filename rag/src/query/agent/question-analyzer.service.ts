import {Injectable}       from "@nestjs/common";
import {LLMService}       from "@/llm/llm.service";
import {QuestionAnalysis} from "@/query/dto/agent-query.dto";

@Injectable()
export class QuestionAnalyzerService {
  constructor(
    private readonly llmService: LLMService,
  ) {
  }

  async analyze(question: string): Promise<QuestionAnalysis> {
    const systemPrompt = `당신은 산업용 장비(AGV/OHT) 센서 데이터 시스템의 질문 분석기입니다.
사용자의 질문을 분석하여 반드시 JSON만 응답하세요.

판단 기준:
- needsSql = true: 집계(개수/평균/최대/최소), 필터링(날짜/장비/상태별), 목록 조회, 비교 등 정형 데이터 질문
- needsSql = false: 특정 장비의 현재 상태 설명, 센서값 해석, 일반적 질문 → 벡터 검색이 적합

추출할 엔티티:
- deviceIds: 언급된 장비 ID (예: "oht01", "agv16")
- metrics: 센서 종류 (pm10, pm25, pm1_0, ntc_temp, ct1~ct4, ir_temp_max, ext_temperature, ext_humidity, ext_illuminance)
- dateFrom/dateTo: 날짜 범위 (YYYY-MM-DD 형식)
- aggregation: 집계 함수 (avg, min, max, count, sum)
- conditions: 기타 조건 (예: "state > 0", "온도 30도 이상")

JSON 응답 형식:
{
  "needsSql": true/false,
  "analysis": "질문 의도 요약",
  "entities": {
    "deviceIds": ["oht01"] 또는 null,
    "metrics": ["ntc_temp"] 또는 null,
    "dateFrom": "2024-08-09" 또는 null,
    "dateTo": "2024-08-10" 또는 null,
    "aggregation": "avg" 또는 null,
    "conditions": ["state > 0"] 또는 null
  }
}`;

    const response: string = await this.llmService.generate(systemPrompt, question);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        return {
          needsSql: false,
          analysis: question,
          entities: {},
        };
      }

      return JSON.parse(jsonMatch[0]) as QuestionAnalysis;
    } catch {
      return {
        needsSql: false,
        analysis: question,
        entities: {},
      };
    }
  }
}

import {
  Injectable,
  Logger,
}                                from "@nestjs/common";
import {SqlGeneratorService}     from "@/query/agent/sql-generator.service";
import {QuestionAnalyzerService} from "@/query/agent/question-analyzer.service";
import {SqlValidatorService}     from "@/query/agent/sql-validator.service";
import {QueryService}            from "@/query/query.service";
import {LLMService}              from "@/llm/llm.service";
import {AgentQueryResponse}      from "@/query/dto/agent-query.dto";

@Injectable()
export class AgentQueryService {
  private readonly logger: Logger = new Logger(AgentQueryService.name);

  constructor(
    private readonly questionAnalyzer: QuestionAnalyzerService,
    private readonly sqlGenerator: SqlGeneratorService,
    private readonly sqlValidator: SqlValidatorService,
    private readonly queryService: QueryService,
    private readonly llmService: LLMService,
  ) {
  }

  async ask(question: string): Promise<AgentQueryResponse> {
    // Step 1: 질문 분석
    this.logger.log(`[Agent 1] 질문 분석 시작: "${question}"`);
    const analysis = await this.questionAnalyzer.analyze(question);
    this.logger.log(`[Agent 1] 분석 결과: needsSql=${analysis.needsSql}, ${analysis.analysis}`);

    // SQL이 불필요하면 벡터 검색으로 위임
    if (!analysis.needsSql) {
      this.logger.log("[라우팅] 벡터 검색으로 위임");
      const vectorResult = await this.queryService.ask(question);
      return {
        ...vectorResult,
        intent: "VECTOR",
      };
    }

    // Step 2: SQL 생성
    this.logger.log("[Agent 2] SQL 생성 시작");
    const generated = await this.sqlGenerator.generate(question, analysis);
    this.logger.log(`[Agent 2] 생성된 SQL: ${generated.sql}`);

    // Step 3: SQL 검증
    this.logger.log("[Agent 3] SQL 검증 시작");
    const validated = this.sqlValidator.validate(generated.sql);

    if (!validated.valid) {
      this.logger.warn(`[Agent 3] 검증 실패: ${validated.issues?.join(", ")}`);
      // 검증 실패 시 벡터 검색으로 fallback
      const vectorResult = await this.queryService.ask(question);
      return {
        ...vectorResult,
        intent: "VECTOR",
      };
    }

    // Step 4: SQL 실행 (오류 시 재시도 포함)
    let rows: Record<string, unknown>[];
    let finalSql: string;

    try {
      const result = await this.sqlValidator.executeWithRetry(validated.sql, question);
      rows = result.rows;
      finalSql = result.finalSql;
    } catch (error) {
      this.logger.error(`[SQL 실행] 최종 실패: ${error.message}`);
      // 실행 실패 시 벡터 검색으로 fallback
      const vectorResult = await this.queryService.ask(question);
      return {
        ...vectorResult,
        intent: "VECTOR",
      };
    }

    // Step 5: 빈 결과 체크
    if (rows.length === 0) {
      return {
        answer: "해당 조건에 맞는 데이터가 없습니다.",
        intent: "SQL",
        sql: finalSql,
        data: [],
      };
    }

    // Step 6: 답변 생성 (Agent 4)
    this.logger.log(`[Agent 4] 답변 생성 (${rows.length}건)`);
    const context = JSON.stringify(rows, null, 2);
    const systemPrompt = `당신은 산업용 AGV/OHT 센서 데이터를 분석하는 전문가입니다.
아래 데이터베이스 조회 결과를 바탕으로 사용자의 질문에 정확히 답변하세요.
- 데이터를 구체적으로 인용하세요 (수치, 장비 ID 등)
- 사용자의 질문과 같은 언어로 답변하세요
- 데이터에 없는 내용은 추측하지 마세요`;

    const userMessage = `실행된 SQL: ${finalSql}\n\n조회 결과 (${rows.length}건):\n${context}\n\n질문: ${question}`;
    const answer = await this.llmService.generate(systemPrompt, userMessage);

    return {
      answer,
      intent: "SQL",
      sql: finalSql,
      data: rows,
    };
  }
}

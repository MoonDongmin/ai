import {
  Inject,
  Injectable,
  Logger,
}                     from "@nestjs/common";
import {
  DRIZZLE,
  type DrizzleDB,
}                     from "@/database/database.provider";
import {LLMService}   from "@/llm/llm.service";
import {ValidatedSql} from "@/query/dto/agent-query.dto";
import {sql}          from "drizzle-orm";

@Injectable()
export class SqlValidatorService {
  private readonly logger: Logger = new Logger(SqlValidatorService.name);
  private readonly ALLOWED_TABLES = ["read_model"];
  private readonly MAX_RETRY = 2;

  constructor(
    @Inject(DRIZZLE)
    private readonly db: DrizzleDB,
    private readonly llmService: LLMService,
  ) {
  }

  validate(rawSql: string): ValidatedSql {
    const issues: string[] = [];
    const normalized: string = rawSql.trim().toLowerCase();

    // 1. SELECT 만 허용
    if (!normalized.startsWith("select")) {
      issues.push(`SELECT 문만 허용됩니다.`);
    }

    // 2. 위험한 키워드 차단
    const forbidden = ["insert", "update", "delete", "drop", "alter", "create", "truncate", "grant", "revoke"];
    for (const keyword of forbidden) {
      // 단어 경계로 체크 (컬럼명에 포함된 경우 오탐 방지)
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (regex.test(rawSql)) {
        issues.push(`금지된 키워드: ${keyword}`);
      }
    }

    // 3. 허용된 테이블만 사용하는지 확인
    const fromMatch = rawSql.match(/\bFROM\s+(\w+)/gi);
    const joinMatch = rawSql.match(/\bJOIN\s+(\w+)/gi);
    const tables = [...(fromMatch ?? []), ...(joinMatch ?? [])]
      .map(m => m.split(/\s+/).pop()!.toLowerCase());

    for (const table of tables) {
      if (!this.ALLOWED_TABLES.includes(table)) {
        issues.push(`허용되지 않은 테이블: ${table}`);
      }
    }

    // 4. LIMIT 없으면 추가
    let finalSql = rawSql;
    if (!normalized.includes("limit") && !normalized.includes("count(") && !normalized.includes("avg(") && !normalized.includes("sum(") && !normalized.includes("min(") && !normalized.includes("max(")) {
      finalSql = rawSql.replace(/;?\s*$/, " LIMIT 50");
    }

    // 5. 세미콜론 제거 (Drizzle sql.raw()에서 불필요)
    finalSql = finalSql.replace(/;\s*$/, "").trim();

    return {
      valid: issues.length === 0,
      sql: finalSql,
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  async executeWithRetry(
    validatedSql: string,
    question: string,
    retryCount = 0,
  ): Promise<{ rows: Record<string, unknown>[]; finalSql: string }> {
    try {
      const result = await this.db.execute(sql.raw(validatedSql));
      return {
        rows: result.rows as Record<string, unknown>[],
        finalSql: validatedSql,
      };
    } catch (error) {
      this.logger.warn(`SQL 실행 오류 (시도 ${retryCount + 1}): ${error.message}`);

      if (retryCount >= this.MAX_RETRY) {
        throw new Error(`SQL 실행 실패 (${this.MAX_RETRY}회 재시도 후): ${error.message}`);
      }

      // LLM에게 오류 정보를 주고 SQL 수정 요청
      const fixPrompt = `아래 SQL이 PostgreSQL에서 오류가 발생했습니다. 수정하세요.

오류: ${error.message}
원본 SQL: ${validatedSql}
사용자 질문: ${question}

read_model 테이블만 사용 가능합니다.
반드시 수정된 SELECT SQL만 응답하세요. JSON이나 설명 없이 SQL만.`;

      const fixedSql = await this.llmService.generate(
        "PostgreSQL SQL 수정 전문가입니다. 오류를 수정한 SQL만 응답하세요.",
        fixPrompt,
      );

      // 수정된 SQL에서 코드블록 마크다운 제거
      const cleaned = fixedSql.replace(/```sql\n?/g, "").replace(/```\n?/g, "").trim();

      // 재검증
      const revalidated = this.validate(cleaned);
      if (!revalidated.valid) {
        throw new Error(`수정된 SQL도 검증 실패: ${revalidated.issues?.join(", ")}`);
      }

      return this.executeWithRetry(revalidated.sql, question, retryCount + 1);
    }
  }

}

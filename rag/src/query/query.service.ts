import {
  Inject,
  Injectable,
}                         from "@nestjs/common";
import {sql}              from "drizzle-orm";
import {
  DRIZZLE,
  type DrizzleDB,
}                         from "@/database/database.provider";
import {EmbeddingService} from "@/embedding/embedding.service";
import {LLMService}       from "@/llm/llm.service";

interface SimilarityResult extends Record<string, unknown> {
  id: number;
  event_id: number;
  device_id: string;
  content: string;
  metadata: any;
  similarity: number;
}

@Injectable()
export class QueryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly embeddingService: EmbeddingService,
    private readonly llmService: LLMService,
  ) {
  }

  async ask(
    question: string,
    options?: { deviceId?: string; topK?: number },
  ) {
    const topK = options?.topK ?? 5;

    // 1. 질문 임베딩
    const queryVector: number[] = await this.embeddingService.embed(question);
    const vectorStr = `[${queryVector.join(",")}]`;

    // 2. pgvector 코사인 유사도 검색
    // Drizzle의 sql 템플릿으로 raw query 실행
    let results: SimilarityResult[];

    if (options?.deviceId) {
      const queryResult = await this.db.execute<SimilarityResult>(sql`
          SELECT id,
                 event_id,
                 device_id,
                 content,
                 metadata,
                 1 - (embedding <=> ${vectorStr}::vector) AS similarity
          FROM embeddings
          WHERE device_id = ${options.deviceId}
          ORDER BY embedding <=> ${vectorStr}::vector
              LIMIT ${topK}
      `);
      results = queryResult.rows;
    } else {
      const queryResult = await this.db.execute<SimilarityResult>(sql`
          SELECT id,
                 event_id,
                 device_id,
                 content,
                 metadata,
                 1 - (embedding <=> ${vectorStr}::vector) AS similarity
          FROM embeddings
          ORDER BY embedding <=> ${vectorStr}::vector
              LIMIT ${topK}
      `);
      results = queryResult.rows;
    }

    // 3. 컨텍스트 조립
    const context: string = results
      .map(
        (r, i) =>
          `[${i + 1}] (유사도: ${Number(r.similarity).toFixed(3)}) ${r.content}`,
      )
      .join("\n\n");

    // 4. LLM으로 답변 생성
    const systemPrompt = `당신은 산업용 AGV/OHT 센서 텔레메트리 데이터를 분석하는 전문가입니다.
제공된 컨텍스트에 기반해서만 질문에 답변하세요.
컨텍스트에 충분한 정보가 없으면 그렇다고 말하세요.
답변 시 참조한 레코드를 인용하세요 (예: [1], [2]).
사용자의 질문과 같은 언어로 답변하세요.`;

    const userMessage = `컨텍스트:\n${context}\n\n질문: ${question}`;

    const answer: string = await this.llmService.generate(systemPrompt, userMessage);

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

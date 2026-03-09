import {Module}                  from "@nestjs/common";
import {EmbeddingModule}         from "@/embedding/embedding.module";
import {LLMModule}               from "@/llm/llm.module";
import {QueryService}            from "@/query/query.service";
import {QueryController}         from "@/query/query.controller";
import {QuestionAnalyzerService} from "@/query/agent/question-analyzer.service";
import {SqlGeneratorService}     from "@/query/agent/sql-generator.service";
import {SqlValidatorService}     from "@/query/agent/sql-validator.service";
import {AgentQueryService}       from "@/query/agent/agent-query.service";

@Module({
  imports: [EmbeddingModule, LLMModule],
  providers: [
    QueryService,
    QuestionAnalyzerService,
    SqlGeneratorService,
    SqlValidatorService,
    AgentQueryService,
  ],
  controllers: [QueryController],
})

export class QueryModule {
}

import {Module}          from "@nestjs/common";
import {EmbeddingModule} from "@/embedding/embedding.module";
import {LLMModule}       from "@/llm/llm.module";
import {QueryService}    from "@/query/query.service";
import {QueryController} from "@/query/query.controller";

@Module({
  imports: [EmbeddingModule, LLMModule],
  providers: [QueryService],
  controllers: [QueryController],
})

export class QueryModule {
}

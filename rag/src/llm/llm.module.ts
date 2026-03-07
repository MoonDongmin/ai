import {Module}     from "@nestjs/common";
import {LLMService} from "@/llm/llm.service";

@Module({
  providers: [LLMService],
  exports: [LLMService],
})

export class LLMModule {
}

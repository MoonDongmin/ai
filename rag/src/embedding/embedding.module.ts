import {Module}             from "@nestjs/common";
import {EmbeddingService}   from "@/embedding/embedding.service";
import {TextBuilderService} from "@/embedding/text-builder.service";

@Module({
  providers: [EmbeddingService, TextBuilderService],
  exports: [EmbeddingService, TextBuilderService],
})
export class EmbeddingModule {
}

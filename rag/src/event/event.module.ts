import {Module}          from "@nestjs/common";
import {EmbeddingModule} from "@/embedding/embedding.module";
import {EventService}    from "@/event/event.service";

@Module({
  imports: [EmbeddingModule],
  providers: [EventService],
  exports: [EventService],
})

export class EventModule {
}

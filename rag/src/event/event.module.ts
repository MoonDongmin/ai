import {Module}          from "@nestjs/common";
import {EmbeddingModule} from "@/embedding/embedding.module";
import {EventService}    from "@/event/event.service";
import {SyncService}     from "@/event/sync.service";

@Module({
  imports: [EmbeddingModule],
  providers: [EventService, SyncService],
  exports: [EventService],
})

export class EventModule {
}

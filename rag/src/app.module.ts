import {Module}          from "@nestjs/common";
import {EventModule}     from "@/event/event.module";
import {
  ConfigModule,
  ConfigService,
}                        from "@nestjs/config";
import configuration     from "@/config/configuration";
import {DatabaseModule}  from "@/database/database.module";
import {EmbeddingModule} from "@/embedding/embedding.module";
import {LLMModule}       from "@/llm/llm.module";
import {QueryModule}     from "@/query/query.module";

@Module({
  imports: [
    EventModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    EmbeddingModule,
    LLMModule,
    QueryModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {
}

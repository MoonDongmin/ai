import {
  Global,
  Module,
}                        from "@nestjs/common";
import {drizzleProvider} from "@/database/database.provider";

@Global()
@Module({
  providers: [drizzleProvider],
  exports: [drizzleProvider],
})

export class DatabaseModule {
}

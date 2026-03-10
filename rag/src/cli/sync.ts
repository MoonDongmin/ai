import {NestFactory}                  from "@nestjs/core";
import {AppModule}                    from "@/app.module";
import {SyncService}                  from "@/event/sync.service";
import type {INestApplicationContext} from "@nestjs/common";

async function main() {
  const app: INestApplicationContext =
    await NestFactory.createApplicationContext(AppModule);

  const syncService: SyncService = app.get(SyncService);

  console.log("Starting sync from event_store → read_model + embeddings...");

  const result = await syncService.syncAll();

  console.log(
    `Done! Success: ${result.success}, Skipped: ${result.skipped}, Failed: ${result.failed}`,
  );

  await app.close();
}

main();

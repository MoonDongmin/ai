import {NestFactory}             from "@nestjs/core";
import {AppModule}               from "@/app.module";
import {EventService}            from "@/event/event.service";
import {Glob}                    from "bun";
import {INestApplicationContext} from "@nestjs/common";

async function main() {
  const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule);
  const eventService: EventService = app.get(EventService);

  // 연도 파라미터: CLI 인자로 전달 가능 (기본값 2024)
  const year: number = parseInt(process.argv[2] ?? "2024", 10);

  const glob = new Glob("**/*.json");
  const dataDir = "./data";
  const files: string[] = [];

  for await (const path of glob.scan({
    cwd: dataDir,
    absolute: true,
  })) {
    files.push(path);
  }

  console.log(`Found ${files.length} JSON files (year: ${year})`);

  const BATCH_SIZE = 50;
  let success: number = 0;
  let failed: number = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((f) => eventService.ingestFile(f, year)),
    );

    for (const result of results) {
      if (result.status === "fulfilled") success++;
      else {
        failed++;
        console.error("Failed:", result.reason);
      }
    }

    console.log(
      `Progress: ${Math.min(i + BATCH_SIZE, files.length)}/${files.length} (success: ${success}, failed: ${failed})`,
    );
  }

  console.log(`Done! Success: ${success}, Failed: ${failed}`);
  await app.close();
}

main();

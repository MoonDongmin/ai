import {
  Inject,
  Injectable,
  Logger,
}                           from "@nestjs/common";
import {
  DRIZZLE,
  type DrizzleDB,
}                           from "@/database/database.provider";
import {EmbeddingService}   from "@/embedding/embedding.service";
import {TextBuilderService} from "@/embedding/text-builder.service";
import {
  embeddings,
  eventStore,
  readModel,
}                           from "@/database/schema";
import {
  eq,
  isNull,
}                           from "drizzle-orm";
import type {
  Annotation,
  ExternalData,
  IrData,
  MetaInfo,
  SensorData,
  SensorEventJson,
}                           from "@/event/dto/sensor-event.dto";

@Injectable()
export class SyncService {
  private readonly logger: Logger = new Logger(SyncService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly embeddingService: EmbeddingService,
    private readonly textBuilder: TextBuilderService,
  ) {
  }

  async syncAll(): Promise<{ success: number; skipped: number; failed: number }> {
    // read_model에 event_id가 없는 event_store 레코드 조회
    const unsyncedEvents = await this.db
      .select({
        id: eventStore.id,
        deviceId: eventStore.deviceId,
        deviceType: eventStore.deviceType,
        collectedAt: eventStore.collectedAt,
        payload: eventStore.payload,
      })
      .from(eventStore)
      .leftJoin(readModel, eq(eventStore.id, readModel.eventId))
      .where(isNull(readModel.id));

    this.logger.log(`Found ${unsyncedEvents.length} unsynced events`);

    let success: number = 0;
    let failed: number = 0;

    const BATCH_SIZE = 50;
    for (let i = 0; i < unsyncedEvents.length; i += BATCH_SIZE) {
      const batch = unsyncedEvents.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((event) =>
          this.syncOne(event.id, event.payload as SensorEventJson, event.collectedAt),
        ),
      );

      for (const result of results) {
        if (result.status === "fulfilled") success++;
        else {
          failed++;
          this.logger.error("Sync failed:", result.reason);
        }
      }

      this.logger.log(
        `Progress: ${Math.min(i + BATCH_SIZE, unsyncedEvents.length)}/${unsyncedEvents.length}`,
      );
    }

    return {
      success,
      skipped: 0,
      failed,
    };
  }

  /**
   * 단일 event_store 레코드 → read_model + embeddings 생성
   */
  private async syncOne(eventId: number, json: SensorEventJson, collectedAt: Date): Promise<void> {
    const meta: MetaInfo = json.meta_info[0];
    const sensors: SensorData = json.sensor_data[0];
    const ir: IrData = json.ir_data[0];
    const annotation: Annotation = json.annotations[0];
    const ext: ExternalData = json.external_data[0];
    const deviceType: string = meta.device_id.replace(/\d+/g, "");

    await this.db.insert(readModel).values({
      eventId,
      deviceId: meta.device_id,
      deviceType,
      deviceManufacturer: meta.device_manufacturer,
      deviceName: meta.device_name,
      installationEnvironment: meta.installation_environment,
      location: meta.location,
      collectedAt: collectedAt,
      pm10: sensors.PM10[0].value,
      pm25: sensors["PM2.5"][0].value,
      pm1_0: sensors["PM1.0"][0].value,
      ntcTemp: sensors.NTC[0].value,
      ct1: sensors.CT1[0].value,
      ct2: sensors.CT2[0].value,
      ct3: sensors.CT3[0].value,
      ct4: sensors.CT4[0].value,
      irTempMax: ir.temp_max[0].value_TGmx,
      irTempMaxX: ir.temp_max[0].X_Tmax,
      irTempMaxY: ir.temp_max[0].Y_Tmax,
      state: parseInt(annotation.tagging[0].state, 10),
      extTemperature: ext.ex_temperature[0].value,
      extHumidity: ext.ex_humidity[0].value,
      extIlluminance: ext.ex_illuminance[0].value,
      cumulativeOpDays: parseInt(meta.cumulative_operating_day, 10),
      equipmentHistory: parseInt(meta.equipment_history, 10),
    });

    // embeddings INSERT
    const text: string = this.textBuilder.build(meta, sensors, ir, annotation, ext);
    const vector: number[] = await this.embeddingService.embed(text);

    await this.db.insert(embeddings).values({
      eventId,
      deviceId: meta.device_id,
      content: text,
      embedding: vector,
      metadata: {
        device_type: deviceType,
        state: annotation.tagging[0].state,
        collected_at: collectedAt.toISOString(),
        installation_environment: meta.installation_environment,
        location: meta.location,
      },
    });
  }
}

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
import {BunFile}            from "bun";
import {
  Annotation,
  ExternalData,
  IrData,
  MetaInfo,
  SensorData,
  SensorEventJson,
}                           from "@/event/dto/sensor-event.dto";
import {
  embeddings,
  eventStore,
  readModel,
}                           from "@/database/schema";
import {eq}                 from "drizzle-orm";

@Injectable()
export class EventService {
  private readonly logger: Logger = new Logger(EventService.name);

  constructor(
    @Inject(DRIZZLE)
    private readonly db: DrizzleDB,
    private readonly embeddingService: EmbeddingService,
    private readonly textBuilder: TextBuilderService,
  ) {
  }

  async ingestFile(filePath: string, year = 2024): Promise<void> {
    const file: BunFile = Bun.file(filePath);
    const json: SensorEventJson = await file.json();
    const meta: MetaInfo = json.meta_info[0];
    const sourceFile: string = meta.filename;

    const existing = await this.db
      .select({id: eventStore.id})
      .from(eventStore)
      .where(eq(eventStore.sourceFile, sourceFile))
      .limit(1);

    if (existing.length > 0) {
      return;
    }

    const collectedAt: Date = this.parseDate(meta.collection_date, meta.collection_time, year);
    const deviceType: string = meta.device_id.replace((/\d+/g), "");

    const [event] = await this.db
      .insert(eventStore)
      .values({
        eventType: "sensor_reading",
        deviceId: meta.device_id,
        deviceType,
        collectedAt,
        payload: json,
        sourceFile,
      })
      .returning({id: eventStore.id});

    const sensors: SensorData = json.sensor_data[0];
    const ir: IrData = json.ir_data[0];
    const annotation: Annotation = json.annotations[0];
    const ext: ExternalData = json.external_data[0];

    await this.db.insert(readModel).values({
      eventId: event.id,
      deviceId: meta.device_id,
      deviceType,
      deviceManufacturer: meta.device_manufacturer,
      deviceName: meta.device_name,
      installationEnvironment: meta.installation_environment,
      location: meta.location,
      collectedAt,
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

    const text: string = this.textBuilder.build(meta, sensors, ir, annotation, ext);
    const vector: number[] = await this.embeddingService.embed(text);

    await this.db.insert(embeddings).values({
      eventId: event.id,
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

  private parseDate(dataStr: string, timeStr: string, year: number): Date {
    const [month, day] = dataStr.split("-");

    return new Date(`${year}-${month}-${day}T${timeStr}`);
  }
}

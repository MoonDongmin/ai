import {
  bigint,
  bigserial,
  integer,
  pgTable,
  PgTableWithColumns,
  real,
  smallint,
  timestamp,
  varchar,
}                   from "drizzle-orm/pg-core";
import {eventStore} from "./event-store.schema";

export const readModel: PgTableWithColumns<any> = pgTable("read_model", {
  id: bigserial("id", {mode: "number"}).primaryKey(),
  eventId: bigint("event_id", {mode: "number"}).notNull().references(() => eventStore.id),
  deviceId: varchar("device_id", {length: 50}).notNull(),
  deviceType: varchar("device_type", {length: 10}).notNull(),
  deviceManufacturer: varchar("device_manufacturer", {length: 50}),
  deviceName: varchar("device_name", {length: 50}),
  installationEnvironment: varchar("installation_environment", {length: 50}),
  location: varchar("location", {length: 100}),
  collectedAt: timestamp("collected_at").notNull(),
  // 먼지 센서
  pm10: real("pm10"),
  pm25: real("pm25"),
  pm1_0: real("pm1_0"),
  // 온도 센서
  ntcTemp: real("ntc_temp"),
  // 전류 센서
  ct1: real("ct1"),
  ct2: real("ct2"),
  ct3: real("ct3"),
  ct4: real("ct4"),
  // IR 열화상
  irTempMax: real("ir_temp_max"),
  irTempMaxX: real("ir_temp_max_x"),
  irTempMaxY: real("ir_temp_max_y"),
  // 어노테이션 (0=정상, 1=경고, 2=이상)
  state: smallint("state").notNull().default(0),
  // 외부 환경
  extTemperature: real("ext_temperature"),
  extHumidity: real("ext_humidity"),
  extIlluminance: real("ext_illuminance"),
  // 메타데이터
  cumulativeOpDays: integer("cumulative_op_days"),
  equipmentHistory: integer("equipment_history"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ReadModelInsert = typeof readModel.$inferInsert;
export type ReadModelSelect = typeof readModel.$inferSelect;

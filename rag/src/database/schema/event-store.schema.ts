import {
  bigserial,
  jsonb,
  pgTable,
  PgTableWithColumns,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const eventStore: PgTableWithColumns<any> = pgTable("event_store", {
  id: bigserial("id", {mode: "number"}).primaryKey(),
  eventType: varchar("event_type", {length: 50}).notNull().default("sensor_reading"),
  deviceId: varchar("device_id", {length: 50}).notNull(),
  deviceType: varchar("device_type", {length: 10}).notNull(),
  collectedAt: timestamp("collected_at").notNull(),
  payload: jsonb("payload").notNull(),
  sourceFile: varchar("source_file", {length: 255}).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type EvenStoreInsert = typeof eventStore.$inferInsert;
export type EvenStoreSelect = typeof eventStore.$inferSelect;

import {
  bigint,
  bigserial,
  customType,
  index,
  jsonb,
  pgTable,
  PgTableWithColumns,
  text,
  timestamp,
  varchar,
}                   from "drizzle-orm/pg-core";
import {eventStore} from "./event-store.schema";

// pgvector 커스텀 타입 정의
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1024)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

export const embeddings: PgTableWithColumns<any> = pgTable(
  "embeddings",
  {
    id: bigserial("id", {mode: "number"}).primaryKey(),
    eventId: bigint("event_id", {mode: "number"}).notNull().references(() => eventStore.id),
    deviceId: varchar("device_id", {length: 50}).notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_embeddings_device_id").on(table.deviceId),
    // HNSW 인덱스는 init.sql에서 생성 (Drizzle이 HNSW 구문을 지원하지 않음)
  ],
);

export type EmbeddingsInsert = typeof embeddings.$inferInsert;
export type EmbeddingsSelect = typeof embeddings.$inferSelect;

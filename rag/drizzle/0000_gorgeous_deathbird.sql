CREATE TABLE "embeddings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" bigint NOT NULL,
	"device_id" varchar(50) NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_store" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_type" varchar(50) DEFAULT 'sensor_reading' NOT NULL,
	"device_id" varchar(50) NOT NULL,
	"device_type" varchar(10) NOT NULL,
	"collected_at" timestamp NOT NULL,
	"payload" jsonb NOT NULL,
	"source_file" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_store_source_file_unique" UNIQUE("source_file")
);
--> statement-breakpoint
CREATE TABLE "read_model" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" bigint NOT NULL,
	"device_id" varchar(50) NOT NULL,
	"device_type" varchar(10) NOT NULL,
	"device_manufacturer" varchar(50),
	"device_name" varchar(50),
	"installation_environment" varchar(50),
	"location" varchar(100),
	"collected_at" timestamp NOT NULL,
	"pm10" real,
	"pm25" real,
	"pm1_0" real,
	"ntc_temp" real,
	"ct1" real,
	"ct2" real,
	"ct3" real,
	"ct4" real,
	"ir_temp_max" real,
	"ir_temp_max_x" real,
	"ir_temp_max_y" real,
	"state" smallint DEFAULT 0 NOT NULL,
	"ext_temperature" real,
	"ext_humidity" real,
	"ext_illuminance" real,
	"cumulative_op_days" integer,
	"equipment_history" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_event_id_event_store_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_model" ADD CONSTRAINT "read_model_event_id_event_store_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_embeddings_device_id" ON "embeddings" USING btree ("device_id");
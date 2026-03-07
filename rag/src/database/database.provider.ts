import {
  drizzle,
  type NodePgDatabase,
} from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import {Pool} from "pg";

export const DRIZZLE: symbol = Symbol("DRIZZLE");

export type DrizzleDB = NodePgDatabase<typeof schema>;

export const drizzleProvider = {
  provide: DRIZZLE,
  useFactory: async () => {
    const pool = new Pool({
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT ?? "5432"),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    });

    return drizzle(pool, {schema});
  },
};

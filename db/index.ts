import { neon } from "@neondatabase/serverless";
import { getConnectionString } from "@netlify/database";
import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.js";

export function getDbUrl(): string {
  if (process.env.NETLIFY_DB_URL) return process.env.NETLIFY_DB_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    return getConnectionString();
  } catch {
    return "";
  }
}

let _neonSqlInstance: any = null;
export function getSqlInstance(): any {
  if (!_neonSqlInstance) {
    const url = getDbUrl();
    if (url) {
      _neonSqlInstance = neon(url);
    }
  }
  return _neonSqlInstance;
}

// Tagged template function: sql`SELECT ...` and sql.query("SELECT ...", [params])
export const sql: any = new Proxy((() => {}) as any, {
  apply(_target, _thisArg, args) {
    const instance = getSqlInstance();
    if (!instance) {
      throw new Error("Database connection string not configured (NETLIFY_DB_URL is missing)");
    }
    return instance(...args);
  },
  get(_target, prop, receiver) {
    if (prop === "query") {
      return (queryStr: string, params: any[] = []) => {
        const instance = getSqlInstance();
        if (!instance) {
          throw new Error("Database connection string not configured (NETLIFY_DB_URL is missing)");
        }
        return instance.query(queryStr, params);
      };
    }
    const instance = getSqlInstance();
    if (instance) {
      return Reflect.get(instance, prop, receiver);
    }
    return undefined;
  },
});

export const db = (drizzle as any)({ schema });

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

export type DbClient = ReturnType<typeof createDb>

/**
 * Creates a Drizzle client from a Postgres connection string.
 * Call once per process and share the returned client.
 *
 * @param url  e.g. "postgres://user:pass@localhost:5432/open_agents"
 */
export function createDb(url: string): ReturnType<typeof drizzle<typeof schema>> {
  const sql = postgres(url, { max: 10 })
  return drizzle(sql, { schema })
}

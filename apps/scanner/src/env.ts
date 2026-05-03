import { z } from 'zod'

const emptyAsUndefined = (v: unknown) => (v === '' ? undefined : v)

const envSchema = z.object({
  PORT: z.coerce.number().default(3002),
  DATABASE_URL: z.string().url(),
  BASE_RPC_URL: z.string().url().default('https://mainnet.base.org'),
  SCAN_LOOKBACK_BLOCKS: z.coerce.number().int().positive().default(3000),
  SCANNER_WEBHOOK: z
    .preprocess(emptyAsUndefined, z.enum(['on', 'off']).optional())
    .transform((v) => v ?? 'on'),
  SCANNER_RPC: z
    .preprocess(emptyAsUndefined, z.enum(['on', 'off']).optional())
    .transform((v) => v ?? 'on'),
  ALCHEMY_NOTIFY_SECRET: z.preprocess(emptyAsUndefined, z.string().min(8).optional()),
  CRON_SECRET: z.preprocess(emptyAsUndefined, z.string().min(8).optional()),
})

export type ScannerEnv = z.infer<typeof envSchema>

let cached: ScannerEnv | null = null

/**
 * Lazy-parsed env. Test files set `process.env.X` at module top level, but
 * because ES modules hoist imports above body, eager parsing inside this
 * file would observe an empty env and throw before the test body runs.
 * The Proxy defers parsing to first read.
 */
export const env: ScannerEnv = new Proxy({} as ScannerEnv, {
  get(_target, prop: string | symbol) {
    if (!cached) cached = envSchema.parse(process.env)
    return Reflect.get(cached, prop)
  },
})

/** Test-only: clears the cached env so a subsequent read re-parses. */
export function resetEnvForTest(): void {
  cached = null
}

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

export const env = envSchema.parse(process.env)

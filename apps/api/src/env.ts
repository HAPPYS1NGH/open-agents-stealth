import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  BASE_RPC_URL: z.string().url().default('https://mainnet.base.org'),
  IDENTITY_REGISTRY_ADDRESS: z
    .string()
    .startsWith('0x')
    .length(42)
    .default('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'),
  SIWE_DOMAIN: z.string().default('localhost'),
})

export const env = envSchema.parse(process.env)

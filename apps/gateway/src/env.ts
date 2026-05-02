import { z } from 'zod'

const emptyAsUndefined = (v: unknown) => (v === '' ? undefined : v)

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  GATEWAY_SIGNER_PRIVATE_KEY: z.string().startsWith('0x').length(66),
  RESOLVER_ADDRESS: z.preprocess(
    emptyAsUndefined,
    z.string().startsWith('0x').length(42).optional(),
  ),
})

export const env = envSchema.parse(process.env)

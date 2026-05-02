import { z } from 'zod'

const emptyAsUndefined = (v: unknown) => (v === '' ? undefined : v)

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  GATEWAY_SIGNER_PRIVATE_KEY: z.string().startsWith('0x').length(66),
  RESOLVER_ADDRESS: z.preprocess(
    emptyAsUndefined,
    z.string().startsWith('0x').length(42).optional(),
  ),
  DATABASE_URL: z.string().url(),
  /**
   * If "off", the gateway does not write rows to gateway_announcements.
   * Default "on" in production; tests opt out for hermetic runs.
   */
  GATEWAY_ANNOUNCEMENTS: z
    .preprocess(emptyAsUndefined, z.enum(['on', 'off']).optional())
    .transform((v) => v ?? 'on'),
})

export const env = envSchema.parse(process.env)

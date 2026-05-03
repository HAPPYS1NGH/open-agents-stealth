#!/usr/bin/env node
/**
 * Plan 4 — one-shot helper for Plan 3 stub: rows.
 *
 * Usage:
 *   pnpm node scripts/flag-stub-agents.mjs --list
 *   pnpm node scripts/flag-stub-agents.mjs --notify
 *   pnpm node scripts/flag-stub-agents.mjs --delete
 *
 * Reads DATABASE_URL from the env. Does NOT touch v1: rows.
 */

import postgres from 'postgres'

const args = process.argv.slice(2)
const mode = args[0]
const VALID = new Set(['--list', '--notify', '--delete'])

if (!mode || !VALID.has(mode)) {
  console.error('Usage: flag-stub-agents.mjs --list | --notify | --delete')
  process.exit(2)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}

const sql = postgres(url, { max: 1 })

try {
  if (mode === '--list') {
    const rows = await sql`
      SELECT id, owner_eoa, subname_label, created_at
      FROM agents
      WHERE view_key_encrypted LIKE 'stub:%' AND is_active = true
      ORDER BY created_at DESC
    `
    console.log(`Found ${rows.length} active stub agent(s):`)
    for (const r of rows) {
      console.log(
        `  ${r.id}  ${r.subname_label.padEnd(24)}  owner=${r.owner_eoa}  created=${r.created_at.toISOString()}`,
      )
    }
  } else if (mode === '--notify') {
    const updated = await sql`
      UPDATE agents
      SET text_records = jsonb_set(coalesce(text_records, '{}'::jsonb), '{needs-reonboard}', '"1"'::jsonb),
          updated_at = now()
      WHERE view_key_encrypted LIKE 'stub:%' AND is_active = true
      RETURNING id
    `
    console.log(`Flagged ${updated.length} stub row(s) with text_records.needs-reonboard='1'.`)
  } else if (mode === '--delete') {
    const updated = await sql`
      UPDATE agents
      SET is_active = false,
          updated_at = now()
      WHERE view_key_encrypted LIKE 'stub:%' AND is_active = true
      RETURNING id
    `
    console.log(`Soft-deleted ${updated.length} stub row(s) (is_active = false).`)
  }
} finally {
  await sql.end({ timeout: 5 })
}

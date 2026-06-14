#!/usr/bin/env node
// Tiny SQL runner for the Supabase project, used to apply migrations and run
// ad-hoc queries from the repo. Reads creds from .env.
//
// Needs a Supabase **Management API** personal token in .env:
//   SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx...
// (Dashboard → Account → Access Tokens → Generate new token.)
// The project ref is derived from SUPABASE_URL.
//
// Usage:
//   node scripts/db.mjs apply supabase/migrations/015_comment_reactions.sql
//   node scripts/db.mjs query "select count(*) from comments"
//   node scripts/db.mjs query @some_file.sql

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
for (const line of readFileSync(join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim()
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim()
const REF = SUPABASE_URL.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]

function die(m) { console.error('db: ' + m); process.exit(1) }
if (!TOKEN) die('SUPABASE_ACCESS_TOKEN not set in .env (Supabase → Account → Access Tokens → generate sbp_…)')
if (!REF) die('could not derive project ref from SUPABASE_URL')

async function runSql(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    die(`${res.status} ${res.statusText}\n${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}`)
  }
  return data
}

const [cmd, ...rest] = process.argv.slice(2)

function resolveSql(arg) {
  if (!arg) die('missing SQL or file path')
  if (arg.startsWith('@')) return readFileSync(arg.slice(1), 'utf8')
  return arg
}

const sql =
  cmd === 'apply' ? readFileSync(rest[0], 'utf8') :
  cmd === 'query' ? resolveSql(rest.join(' ')) :
  null

if (sql == null) die('usage: db.mjs apply <file.sql> | query "<sql>" | query @file.sql')

const out = await runSql(sql)
if (cmd === 'apply') {
  console.log(`applied ${rest[0]} ✓`)
} else {
  console.log(JSON.stringify(out, null, 2))
}

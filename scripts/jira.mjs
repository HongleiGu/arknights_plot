#!/usr/bin/env node
// Zero-dependency Jira Cloud CLI. Run via `pnpm jira <command> [...args]`.
// Auth + site come from .env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.
//
// Commands:
//   whoami                         Show the authenticated account (auth smoke test)
//   projects                       List all visible projects
//   project <KEY>                  Show one project's details
//   issues [JQL]                   Search issues (default JQL: project = $JIRA_PROJECT)
//   issue <KEY>                    Show one issue
//   create <TYPE> <SUMMARY...>     Create an issue (TYPE e.g. Task/Bug/Story)
//   comment <KEY> <TEXT...>        Add a comment to an issue
//   transition <KEY> [STATUS]      List transitions, or move issue to STATUS
//   request <METHOD> <PATH> [BODY] Raw REST passthrough (PATH relative to /rest/api/3)
//
// Examples:
//   pnpm jira whoami
//   pnpm jira issues "project = AKP AND status != Done ORDER BY created DESC"
//   pnpm jira create Task "Wire up chapter reader page"
//   pnpm jira request GET /myself

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  // pnpm does not auto-load .env, so parse it ourselves (process.env wins if already set).
  try {
    const raw = readFileSync(join(__dirname, '..', '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // no .env — rely on real process.env
  }
}

loadEnv();

const BASE = (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
const EMAIL = process.env.JIRA_EMAIL || '';
const TOKEN = process.env.JIRA_API_TOKEN || '';
const PROJECT = process.env.JIRA_PROJECT || '';

function die(msg) {
  console.error('jira: ' + msg);
  process.exit(1);
}

if (!BASE) die('JIRA_BASE_URL is not set in .env (e.g. https://your-site.atlassian.net)');
if (!EMAIL || !TOKEN) die('JIRA_EMAIL / JIRA_API_TOKEN missing in .env');

const AUTH = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

async function api(method, path, body) {
  const url = path.startsWith('http')
    ? path
    : `${BASE}/rest/api/3${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: AUTH,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    die(`${method} ${url} -> ${res.status} ${res.statusText}\n${detail}`);
  }
  return data;
}

// Atlassian Document Format wrapper for plain text (comments, descriptions).
function adf(text) {
  return {
    type: 'doc',
    version: 1,
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  };
}

function pad(s, n) { s = String(s ?? ''); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'whoami': {
      const me = await api('GET', '/myself');
      console.log(`${me.displayName}  <${me.emailAddress}>`);
      console.log(`accountId: ${me.accountId}`);
      console.log(`site:      ${BASE}`);
      break;
    }
    case 'projects': {
      const r = await api('GET', '/project/search?maxResults=100');
      for (const p of r.values) console.log(`${pad(p.key, 12)} ${p.name}`);
      console.log(`\n${r.total} project(s)`);
      break;
    }
    case 'project': {
      const key = args[0] || PROJECT;
      if (!key) die('usage: jira project <KEY>  (or set JIRA_PROJECT)');
      const p = await api('GET', `/project/${encodeURIComponent(key)}`);
      console.log(`${p.key} — ${p.name}`);
      console.log(`id:    ${p.id}`);
      console.log(`lead:  ${p.lead?.displayName ?? '-'}`);
      console.log(`types: ${(p.issueTypes || []).map((t) => t.name).join(', ')}`);
      break;
    }
    case 'issues': {
      const jql = args.join(' ') || (PROJECT ? `project = ${PROJECT} ORDER BY created DESC` : '');
      if (!jql) die('usage: jira issues "<JQL>"  (or set JIRA_PROJECT for a default)');
      const r = await api('POST', '/search/jql', {
        jql,
        maxResults: 50,
        fields: ['summary', 'status', 'assignee', 'issuetype'],
      });
      for (const i of r.issues || []) {
        console.log(
          `${pad(i.key, 12)} ${pad(i.fields.issuetype?.name, 8)} ${pad(i.fields.status?.name, 14)} ${i.fields.summary}`
        );
      }
      console.log(`\n${(r.issues || []).length} issue(s)`);
      break;
    }
    case 'issue': {
      const key = args[0];
      if (!key) die('usage: jira issue <KEY>');
      const i = await api('GET', `/issue/${encodeURIComponent(key)}`);
      const f = i.fields;
      console.log(`${i.key}  [${f.issuetype?.name}]  ${f.status?.name}`);
      console.log(`summary:  ${f.summary}`);
      console.log(`assignee: ${f.assignee?.displayName ?? '-'}`);
      console.log(`reporter: ${f.reporter?.displayName ?? '-'}`);
      console.log(`created:  ${f.created}`);
      console.log(`url:      ${BASE}/browse/${i.key}`);
      break;
    }
    case 'create': {
      const type = args[0];
      const summary = args.slice(1).join(' ');
      const key = PROJECT;
      if (!key) die('set JIRA_PROJECT in .env to create issues');
      if (!type || !summary) die('usage: jira create <TYPE> <SUMMARY...>');
      const r = await api('POST', '/issue', {
        fields: {
          project: { key },
          issuetype: { name: type },
          summary,
        },
      });
      console.log(`created ${r.key}  ${BASE}/browse/${r.key}`);
      break;
    }
    case 'comment': {
      const key = args[0];
      const text = args.slice(1).join(' ');
      if (!key || !text) die('usage: jira comment <KEY> <TEXT...>');
      const r = await api('POST', `/issue/${encodeURIComponent(key)}/comment`, { body: adf(text) });
      console.log(`commented on ${key} (id ${r.id})`);
      break;
    }
    case 'transition': {
      const key = args[0];
      const target = args.slice(1).join(' ');
      if (!key) die('usage: jira transition <KEY> [STATUS]');
      const r = await api('GET', `/issue/${encodeURIComponent(key)}/transitions`);
      if (!target) {
        for (const t of r.transitions) console.log(`${pad(t.id, 6)} -> ${t.to.name}`);
        break;
      }
      const t = r.transitions.find(
        (x) => x.to.name.toLowerCase() === target.toLowerCase() || x.name.toLowerCase() === target.toLowerCase()
      );
      if (!t) die(`no transition to "${target}". Available: ${r.transitions.map((x) => x.to.name).join(', ')}`);
      await api('POST', `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: t.id } });
      console.log(`${key} -> ${t.to.name}`);
      break;
    }
    case 'request': {
      const [method, path, ...rest] = args;
      if (!method || !path) die('usage: jira request <METHOD> <PATH> [JSON_BODY | @file.json]');
      const rawBody = rest.join(' ').trim();
      // `@path` reads the JSON body from a file (curl-style) — avoids shell-quoting
      // hell for large/Unicode payloads.
      const body = !rawBody
        ? undefined
        : rawBody.startsWith('@')
          ? JSON.parse(readFileSync(rawBody.slice(1), 'utf8'))
          : JSON.parse(rawBody);
      const data = await api(method.toUpperCase(), path, body);
      console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
      break;
    }
    default:
      console.log(`Jira CLI — usage: pnpm jira <command> [args]

  whoami                          authenticated account (auth smoke test)
  projects                        list visible projects
  project <KEY>                   show a project
  issues [JQL]                    search issues (defaults to JIRA_PROJECT)
  issue <KEY>                     show an issue
  create <TYPE> <SUMMARY...>      create an issue in JIRA_PROJECT
  comment <KEY> <TEXT...>         add a comment
  transition <KEY> [STATUS]       list/apply workflow transitions
  request <METHOD> <PATH> [BODY]  raw REST call (PATH under /rest/api/3)

env (.env): JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT (optional)`);
      if (cmd && cmd !== 'help' && cmd !== '--help') process.exit(1);
  }
}

main().catch((e) => die(e.message));

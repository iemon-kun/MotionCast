#!/usr/bin/env node
/*
  Sync changed Docs/issues/*.md to GitHub Issues.
  - Parses YAML front matter via gray-matter (no custom awk/jq parsing)
  - Creates or edits issues
  - Reconciles labels/assignees (add/remove diff)
  - Safe on multiple-file pushes; ignores bot/self loops (handled in workflow)
*/

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import matter from 'gray-matter';

const REPO = process.env.GITHUB_REPOSITORY;
const GH = 'gh';

function runGh(args, opts = {}) {
  const res = spawnSync(GH, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    ...opts,
  });
  if (res.status !== 0) {
    const msg = `gh ${args.join(' ')} failed: ${res.stderr || res.stdout}`;
    throw new Error(msg);
  }
  return res.stdout.trim();
}

function toArray(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    // allow comma or space separated
    return v
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [String(v)];
}

function diffSets(current = [], next = []) {
  const cur = new Set(current);
  const nxt = new Set(next);
  const add = [...nxt].filter((x) => !cur.has(x));
  const remove = [...cur].filter((x) => !nxt.has(x));
  return { add, remove };
}

function parseFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const fm = matter(content);
  const data = fm.data || {};
  const body = (fm.content || '').trim();
  const issueNum = data.issue != null && String(data.issue).trim() !== ''
    ? Number(String(data.issue).trim())
    : null;
  const title = (data.title && String(data.title)) || path.basename(file, '.md');
  const labels = toArray(data.labels);
  const assignees = toArray(data.assignees);
  return { issueNum, title, labels, assignees, body };
}

function createIssue({ title, labels, assignees, body }) {
  const args = [
    'issue', 'create',
    '--repo', REPO,
    '--title', title,
    '--body', body || '(no body)'
  ];
  labels.forEach((l) => args.push('--label', l));
  assignees.forEach((a) => args.push('--assignee', a));
  const out = runGh(args);
  return out; // typically returns created issue URL
}

function getIssueMeta(n) {
  const out = runGh(['issue', 'view', String(n), '--repo', REPO, '--json', 'labels,assignees,title,body']);
  return JSON.parse(out);
}

function editIssue(n, { title, body, labels, assignees }) {
  // Title/body
  runGh(['issue', 'edit', String(n), '--repo', REPO, '--title', title, '--body', body || '(no body)']);
  // Labels reconcile
  const cur = getIssueMeta(n);
  const curLabels = (cur.labels || []).map((x) => x.name);
  const curAssignees = (cur.assignees || []).map((x) => x.login);
  const { add: addL, remove: rmL } = diffSets(curLabels, labels);
  const { add: addA, remove: rmA } = diffSets(curAssignees, assignees);
  if (addL.length || rmL.length) {
    const args = ['issue', 'edit', String(n), '--repo', REPO];
    addL.forEach((l) => args.push('--add-label', l));
    rmL.forEach((l) => args.push('--remove-label', l));
    runGh(args);
  }
  if (addA.length || rmA.length) {
    const args = ['issue', 'edit', String(n), '--repo', REPO];
    addA.forEach((a) => args.push('--add-assignee', a));
    rmA.forEach((a) => args.push('--remove-assignee', a));
    runGh(args);
  }
}

function writeBackIssueNumber(file, number) {
  const content = fs.readFileSync(file, 'utf8');
  const fm = matter(content);
  const data = { ...(fm.data || {}) };
  if (data.issue && String(data.issue).trim() !== '') return false; // already has number
  data.issue = Number(number);
  const next = matter.stringify(fm.content, data);
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

function main() {
  const raw = (process.env.CHANGED_FILES || '').trim();
  if (!raw) {
    console.log('No changed MD files. Skipping.');
    return;
  }
  const files = raw.split(/\r?\n/).filter(Boolean);
  for (const file of files) {
    try {
      const { issueNum, title, labels, assignees, body } = parseFile(file);
      if (!issueNum) {
        console.log(`Creating issue from ${file}`);
        const url = createIssue({ title, labels, assignees, body });
        console.log(`Created: ${url}`);
        // Try to extract number from URL (…/issues/<num>)
        const m = String(url).match(/issues\/(\d+)/);
        if (m && m[1]) {
          const n = Number(m[1]);
          if (Number.isFinite(n)) {
            const changed = writeBackIssueNumber(file, n);
            if (changed) console.log(`Wrote back issue: ${n} into ${file}`);
          }
        } else {
          // Fallback: query latest created by title (best-effort)
          try {
            const out = runGh(['issue', 'list', '--repo', REPO, '--search', `"${title}" in:title`, '--state', 'open', '--json', 'number,title', '--limit', '1']);
            const arr = JSON.parse(out);
            if (Array.isArray(arr) && arr[0]?.number) {
              const n = Number(arr[0].number);
              const changed = writeBackIssueNumber(file, n);
              if (changed) console.log(`Wrote back issue (fallback): ${n} into ${file}`);
            }
          } catch {}
        }
      } else {
        console.log(`Editing issue #${issueNum} from ${file}`);
        editIssue(issueNum, { title, body, labels, assignees });
        console.log(`Edited: #${issueNum}`);
      }
    } catch (e) {
      console.error(`Error processing ${file}:`, e.message || e);
      // continue with next file
    }
  }
}

main();

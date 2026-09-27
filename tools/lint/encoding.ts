/**
 * Encoding lint: finds UTF-8 BOMs, invalid UTF-8, U+FFFD and CJK damage (CJK saved as runs of '?', mojibake) in
 * text files. Exit code 1 when anything is found; each finding prints as file:line:column.
 *
 *   pnpm lint:encoding                     all git-tracked and new (not ignored) .ts .json .md .html .css .yaml files
 *   pnpm lint:encoding game tools/x.ts     only these files / directories
 *   pnpm lint:encoding --fix               also strip UTF-8 BOMs in place (the only automatic fix)
 *
 * Options:
 *   --fix          remove BOMs from the checked files
 *   --help         print this help
 *
 * Skips node_modules, dist and .shots. Detector: tools/lint/encoding-check.ts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitWithUsage } from '../common/app';
import { checkEncoding, isEncodingCandidate, type EncodingIssue } from './encoding-check';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function gitFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  return [...new Set(out.split('\0').filter(Boolean))].map((f) => join(ROOT, f));
}

function walk(path: string, out: string[]): void {
  const st = statSync(path);
  if (st.isFile()) {
    out.push(path);
    return;
  }
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === 'dist' || name === '.shots' || name === '.git') continue;
    walk(join(path, name), out);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  let fix = false;
  const paths: string[] = [];
  for (const a of args) {
    if (a === '--fix') fix = true;
    else if (a === '--help' || a === '-h') exitWithUsage(import.meta.url);
    else if (a.startsWith('-')) exitWithUsage(import.meta.url, `unknown option ${a}`);
    else paths.push(a);
  }
  const candidates: string[] = [];
  if (paths.length) {
    for (const p of paths) {
      if (!existsSync(p)) exitWithUsage(import.meta.url, `no such file or directory: ${p}`);
      walk(resolve(p), candidates);
    }
  } else candidates.push(...gitFiles());

  const files = candidates.filter((f) => isEncodingCandidate(relative(ROOT, f)) && existsSync(f));
  let issueCount = 0;
  let badFiles = 0;
  let fixed = 0;
  for (const file of files) {
    let bytes: Uint8Array = readFileSync(file);
    let issues: EncodingIssue[] = checkEncoding(file, bytes);
    if (fix && issues.some((i) => i.rule === 'bom')) {
      bytes = bytes.subarray(3);
      writeFileSync(file, bytes);
      fixed++;
      issues = issues.filter((i) => i.rule !== 'bom');
    }
    if (!issues.length) continue;
    badFiles++;
    issueCount += issues.length;
    const rel = relative(process.cwd(), file).replace(/\\/g, '/');
    const lines = new TextDecoder().decode(bytes).split('\n');
    for (const i of issues) {
      console.log(`${rel}:${i.line}:${i.column}  ${i.rule}  ${i.message}`);
      const src = (lines[i.line - 1] ?? '').trim();
      if (src && i.rule !== 'bom') console.log(`    ${src.length > 120 ? `${src.slice(0, 117)}...` : src}`);
    }
  }
  const fixNote = fixed ? `, stripped ${fixed} BOM(s)` : '';
  if (issueCount) {
    console.log(`\nencoding: ${issueCount} issue(s) in ${badFiles} file(s) (${files.length} checked${fixNote})`);
    process.exitCode = 1;
  } else console.log(`encoding: ok (${files.length} files checked${fixNote})`);
}

main();

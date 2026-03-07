import * as path from 'path';
import * as fs from 'fs';
import { FhirValidator } from '../dist';
import type { ValidationResult, ValidationIssue } from '../dist';

// ANSI color helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
};

/** Wraps text in the given ANSI color code, appending a reset sequence */
const c = (color: keyof typeof colors, text: string) => `${colors[color]}${text}${colors.reset}`;

/** Returns the ANSI color code for a given validation issue severity */
function severityColor(severity: string): string {
  switch (severity) {
    case 'error': return colors.red;
    case 'warning': return colors.yellow;
    case 'information': return colors.cyan;
    default: return colors.white;
  }
}

/** Returns a single-character icon representing the issue severity (x, !, i) */
function severityIcon(severity: string): string {
  switch (severity) {
    case 'error': return 'x';
    case 'warning': return '!';
    case 'information': return 'i';
    default: return '-';
  }
}

/**
 * Prints a color-coded validation result for a single file.
 * Shows PASS/FAIL status, issue counts by severity, and individual issue details.
 * @param filePath - Absolute path to the validated file
 * @param result - The validation result to display
 */
function printResult(filePath: string, result: ValidationResult): void {
  const rel = path.relative(process.cwd(), filePath);
  const status = result.valid
    ? c('green', 'PASS')
    : c('red', 'FAIL');

  const errors = result.issues.filter(i => i.severity === 'error').length;
  const warnings = result.issues.filter(i => i.severity === 'warning').length;
  const infos = result.issues.filter(i => i.severity === 'information').length;

  const parts: string[] = [];
  if (errors > 0) parts.push(c('red', `${errors} error${errors !== 1 ? 's' : ''}`));
  if (warnings > 0) parts.push(c('yellow', `${warnings} warning${warnings !== 1 ? 's' : ''}`));
  if (infos > 0) parts.push(c('cyan', `${infos} info`));
  const summary = parts.length > 0 ? ` (${parts.join(', ')})` : '';

  console.log(`  ${status} ${c('bold', rel)}${summary}`);

  for (const issue of result.issues) {
    const color = severityColor(issue.severity);
    const icon = severityIcon(issue.severity);
    const codePart = issue.code ? c('dim', ` [${issue.code}]`) : '';
    console.log(`       ${color}${icon}${colors.reset} ${c('dim', issue.path || '(root)')} ${issue.message}${codePart}`);
  }
}

/** Clears the current line on stderr (used to overwrite the progress bar) */
function clearLine(): void {
  process.stderr.write('\r\x1b[K');
}

/**
 * Renders a progress bar on stderr showing validation progress.
 * Overwrites the current line each time it is called.
 * @param current - Number of files processed so far
 * @param total - Total number of files to validate
 * @param filePath - Path of the file currently being validated (basename shown)
 */
function showProgress(current: number, total: number, filePath: string): void {
  const pct = Math.round((current / total) * 100);
  const barLen = 20;
  const filled = Math.round((current / total) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  const rel = path.basename(filePath);
  const truncated = rel.length > 40 ? rel.slice(0, 37) + '...' : rel;
  process.stderr.write(`\r  ${c('dim', `[${bar}]`)} ${pct}% (${current}/${total}) ${c('dim', truncated)}`);
}

/**
 * Recursively collects all .json files from a directory tree.
 * @param dirPath - Root directory to scan
 * @returns Array of absolute paths to JSON files
 */
function collectJsonFiles(dirPath: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

/** Prints CLI usage instructions and available options to stdout */
function printUsage(): void {
  console.log(`
${c('bold', 'FHIR Validator CLI')}

${c('bold', 'Usage:')}
  npx ts-node cli/validate.ts <file-or-directory> [options]

${c('bold', 'Options:')}
  --profiles-dir <dir>     Add profiles directory (repeatable)
  --terminology-dir <dir>  Add terminology directory (repeatable)
  --config <path>          Path to config.local.json
  --help                   Show this help
`);
}

/**
 * CLI entry point. Parses arguments, initializes the FHIR validator,
 * validates the target file or directory, and prints color-coded results.
 * Exits with code 0 if all files pass, 1 if any fail, or 2 on fatal error.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    printUsage();
    process.exit(args.includes('--help') ? 0 : 1);
  }

  const profilesDirs: string[] = [];
  const terminologyDirs: string[] = [];
  let configPath: string | undefined;
  let target: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--profiles-dir':
        profilesDirs.push(path.resolve(args[++i]));
        break;
      case '--terminology-dir':
        terminologyDirs.push(path.resolve(args[++i]));
        break;
      case '--config':
        configPath = path.resolve(args[++i]);
        break;
      default:
        if (args[i].startsWith('-')) {
          console.error(c('red', `Unknown option: ${args[i]}`));
          process.exit(1);
        }
        target = path.resolve(args[i]);
    }
  }

  if (!target) {
    console.error(c('red', 'No file or directory specified.'));
    process.exit(1);
  }

  // Default profile/terminology dirs
  const root = path.resolve(__dirname, '..');
  if (profilesDirs.length === 0) {
    profilesDirs.push(path.join(root, 'profiles', 'r4-core'), path.join(root, 'profiles', 'nl-core'));
  }
  if (terminologyDirs.length === 0) {
    terminologyDirs.push(path.join(root, 'terminology', 'r4-core'), path.join(root, 'terminology', 'nl-core'));
  }

  // Load config
  const config = await FhirValidator.loadConfig(configPath ?? path.join(root, 'config.local.json'));

  // Create validator
  console.log(c('dim', 'Loading profiles and terminology...'));
  const validator = await FhirValidator.create({
    profilesDirs,
    terminologyDirs,
    terminology: { nictiz: config?.terminology },
  });
  const stats = validator.stats();
  console.log(c('dim', `Loaded ${stats.profiles} profiles, ${stats.valueSets} value sets, ${stats.codeSystems} code systems\n`));

  // Collect files
  const stat = fs.statSync(target);
  const files = stat.isDirectory() ? collectJsonFiles(target) : [target];
  const isDir = stat.isDirectory();

  if (files.length === 0) {
    console.log(c('yellow', 'No JSON files found.'));
    process.exit(0);
  }

  if (isDir) {
    console.log(c('bold', `Validating ${files.length} file${files.length !== 1 ? 's' : ''}...\n`));
  }

  // Preload for batch
  if (files.length > 1) {
    await validator.preload();
  }

  let passed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (isDir) {
      showProgress(i + 1, files.length, file);
    }

    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      clearLine();
      console.log(`  ${c('red', 'FAIL')} ${c('bold', path.relative(process.cwd(), file))}`);
      console.log(`       ${c('red', 'x')} Could not read file`);
      failed++;
      continue;
    }

    let resource: unknown;
    try {
      resource = JSON.parse(raw);
    } catch {
      clearLine();
      console.log(`  ${c('red', 'FAIL')} ${c('bold', path.relative(process.cwd(), file))}`);
      console.log(`       ${c('red', 'x')} Invalid JSON`);
      failed++;
      continue;
    }

    // Skip non-resource JSON (e.g. StructureDefinitions, ValueSets)
    const rt = (resource as Record<string, unknown>).resourceType as string | undefined;
    if (!rt) {
      continue;
    }

    const result = await validator.validate(resource);

    if (isDir) {
      clearLine();
    }

    printResult(file, result);

    if (result.valid) {
      passed++;
    } else {
      failed++;
    }
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${c('bold', '─── Summary ───')}`);
  console.log(`  ${c('green', `${passed} passed`)}  ${failed > 0 ? c('red', `${failed} failed`) : c('dim', '0 failed')}  ${c('dim', `(${elapsed}s)`)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: Error) => {
  console.error(c('red', `Fatal error: ${err.message}`));
  process.exit(2);
});

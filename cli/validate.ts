import * as path from 'path';
import { FhirValidator, ValidationRunner } from '../dist';
import type { ValidationResult } from '../dist';

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
const severityColor = (severity: string): string => {
  switch (severity) {
    case 'error': return colors.red;
    case 'warning': return colors.yellow;
    case 'information': return colors.cyan;
    default: return colors.white;
  }
};

/** Returns a single-character icon representing the issue severity (x, !, i) */
const severityIcon = (severity: string): string => {
  switch (severity) {
    case 'error': return 'x';
    case 'warning': return '!';
    case 'information': return 'i';
    default: return '-';
  }
};

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
    terminology: {
      nictiz: config?.terminology,
      artDecor: { cacheDir: path.join(root, '.art-decor-cache') },
    },
    indexCachePath: path.join(root, '.fhir-index.json'),
  });
  const stats = validator.stats();
  console.log(c('dim', `Loaded ${stats.profiles} profiles, ${stats.valueSets} value sets, ${stats.codeSystems} code systems\n`));

  // Create runner and wire up events
  const runner = new ValidationRunner(validator);
  let isDir = false;

  try {
    const fs = await import('fs');
    isDir = fs.statSync(target).isDirectory();
  } catch { /* target doesn't exist — runner.run() will emit error */ }

  if (isDir) {
    runner.on('progress', ({ current, total, file }) => showProgress(current, total, file));
  }

  runner.on('pass', ({ file, result }) => {
    if (isDir) clearLine();
    printResult(file, result);
  });

  runner.on('fail', ({ file, result }) => {
    if (isDir) clearLine();
    printResult(file, result);
  });

  runner.on('error', ({ file, error }) => {
    if (isDir) clearLine();
    console.log(`  ${c('red', 'FAIL')} ${c('bold', path.relative(process.cwd(), file))}`);
    console.log(`       ${c('red', 'x')} ${error.message}`);
  });

  const summary = await runner.run(target);

  const elapsed = (summary.elapsedMs / 1000).toFixed(1);
  console.log(`\n${c('bold', '─── Summary ───')}`);
  console.log(`  ${c('green', `${summary.passed} passed`)}  ${summary.failed > 0 ? c('red', `${summary.failed} failed`) : c('dim', '0 failed')}  ${c('dim', `(${elapsed}s)`)}`);

  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((err: Error) => {
  console.error(c('red', `Fatal error: ${err.message}`));
  process.exit(2);
});

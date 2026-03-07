import { EventEmitter } from 'events';
import { readFile, readdir, stat } from 'fs/promises';
import * as path from 'path';
import type { ValidationResult } from '../types/fhir';
import type { FhirValidator } from '../validator/fhir-validator';

/** Summary emitted with the 'finish' event */
export interface RunnerSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  elapsedMs: number;
}

/** Payload emitted with 'pass' and 'fail' events */
export interface FileResult {
  file: string;
  result: ValidationResult;
}

/** Payload emitted with the 'error' event */
export interface FileError {
  file: string;
  error: Error;
}

/** Payload emitted with the 'progress' event */
export interface RunnerProgress {
  current: number;
  total: number;
  file: string;
}

/** Event map for typed event listeners */
export interface ValidationRunnerEvents {
  pass: [FileResult];
  fail: [FileResult];
  error: [FileError];
  skip: [{ file: string; reason: string }];
  progress: [RunnerProgress];
  finish: [RunnerSummary];
}

/**
 * Runs FHIR validation over files or directories with event-based reporting.
 * Extends EventEmitter so consumers can hook into pass, fail, error, progress, and finish events.
 *
 * @example
 * ```typescript
 * const runner = new ValidationRunner(validator);
 * runner.on('fail', ({ file, result }) => console.log(file, result.issues));
 * runner.on('finish', (summary) => console.log(summary));
 * await runner.run('samples/data/');
 * ```
 */
export class ValidationRunner extends EventEmitter<ValidationRunnerEvents> {

  private validator: FhirValidator;

  constructor(validator: FhirValidator) {
    super();
    this.validator = validator;
  }

  /**
   * Validates a file or directory. If given a directory, recursively collects all .json files.
   * Emits events as each file is processed.
   * @param targetPath - Absolute or relative path to a JSON file or directory
   * @returns Summary with pass/fail/skip counts and elapsed time
   */
  async run(targetPath: string): Promise<RunnerSummary> {
    const resolved = path.resolve(targetPath);
    const info = await stat(resolved);
    const files = info.isDirectory() ? await this.collectJsonFiles(resolved) : [resolved];

    return this.validateFiles(files);
  }

  /**
   * Validates an explicit list of file paths.
   * Emits events as each file is processed.
   * @param files - Array of absolute paths to JSON files
   * @returns Summary with pass/fail/skip counts and elapsed time
   */
  async validateFiles(files: string[]): Promise<RunnerSummary> {
    const total = files.length;

    if (total > 1) {
      await this.validator.preload();
    }

    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const startTime = Date.now();

    for (let i = 0; i < total; i++) {
      const file = files[i];
      this.emit('progress', { current: i + 1, total, file });

      let raw: string;

      try {
        raw = await readFile(file, 'utf8');
      } catch (err) {
        this.emit('error', { file, error: err instanceof Error ? err : new Error(String(err)) });
        failed++;
        continue;
      }

      let resource: unknown;

      try {
        resource = JSON.parse(raw);
      } catch {
        this.emit('error', { file, error: new Error('Invalid JSON') });
        failed++;
        continue;
      }

      const rt = (resource as Record<string, unknown>).resourceType;

      if (!rt || typeof rt !== 'string') {
        skipped++;
        this.emit('skip', { file, reason: 'No resourceType' });
        continue;
      }

      const result = await this.validator.validate(resource);

      if (result.valid) {
        passed++;
        this.emit('pass', { file, result });
      } else {
        failed++;
        this.emit('fail', { file, result });
      }
    }

    const summary: RunnerSummary = { passed, failed, skipped, total, elapsedMs: Date.now() - startTime };
    this.emit('finish', summary);

    return summary;
  }

  /** Recursively collects all .json files from a directory tree */
  private async collectJsonFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        files.push(...await this.collectJsonFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(full);
      }
    }

    return files;
  }
}

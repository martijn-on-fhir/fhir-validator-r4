import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { FhirPathEngine } from '../fhirpath/fhir-path-engine';
import { FileIndex } from '../registry/file-index';
import { StructureDefinitionRegistry } from '../registry/structure-definition-registry';
import { StructuralValidator } from '../structural/structural-validator';
import type { NictizTerminologyConfig } from '../terminology/nictiz-terminology-client';
import { TerminologyService, type TerminologyServiceOptions } from '../terminology/terminology-service';
import type { IssueSeverity, ValidationIssue, ValidationResult } from '../types/fhir';

/** Configurable severity overrides per issue code */
export type SeverityOverrides = Record<string, IssueSeverity>;

export interface FhirValidatorOptions {

  /** Directories with StructureDefinition JSON files (loaded in order) */
  profilesDirs?: string[];
  /** Directories with ValueSet / CodeSystem JSON files (loaded in order) */
  terminologyDirs?: string[];
  /** Options for external terminology server */
  terminology?: TerminologyServiceOptions;
  /** Override severity for specific issue codes (e.g. { CODE_INVALID: 'warning' }) */
  severityOverrides?: SeverityOverrides;
  /** Accepted FHIR version (e.g. "4.0.1"). If set, resources with a different fhirVersion in meta are rejected. */
  fhirVersion?: string;
  /** Path to store the index cache file (default: .fhir-index.json in first profiles dir) */
  indexCachePath?: string;
  /** Force eager loading of all files instead of lazy loading (default: false) */
  eagerLoad?: boolean;
}

// Known dangerous keys that can cause prototype pollution
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class FhirValidator {

  readonly registry: StructureDefinitionRegistry;
  readonly terminology: TerminologyService;
  readonly fhirPath: FhirPathEngine;
  private structural: StructuralValidator;
  private severityOverrides: SeverityOverrides;
  private fhirVersion?: string;

  private constructor(options: TerminologyServiceOptions = {}, severityOverrides: SeverityOverrides = {}, fhirVersion?: string, artDecorCacheDir?: string) {

    // Auto-enable art-decor disk cache if a directory is provided
    if (artDecorCacheDir && !options.artDecor?.cacheDir) {
      options = {
        ...options,
        artDecor: {...options.artDecor, cacheDir: artDecorCacheDir},
      };
    }

    this.registry = new StructureDefinitionRegistry();
    this.terminology = new TerminologyService(options);
    this.fhirPath = new FhirPathEngine();
    this.structural = new StructuralValidator(
      this.registry,
      this.terminology,
      this.fhirPath
    );
    this.severityOverrides = severityOverrides;
    this.fhirVersion = fhirVersion;
  }

  /**
   * Factory method — loads profiles and terminology for use.
   * Directories are loaded in order (e.g. r4-core first, then nl-core).
   * Uses lazy loading by default: only an index is built at startup,
   * actual files are loaded on demand when resolve() or validateCode() needs them.
   */
  static async create(options: FhirValidatorOptions = {}): Promise<FhirValidator> {

    const allDirs = [...(options.profilesDirs ?? []), ...(options.terminologyDirs ?? [])];
    const artDecorCacheDir = allDirs.length > 0
      ? path.join(allDirs[0], '..', '.art-decor-cache')
      : undefined;

    const validator = new FhirValidator(options.terminology, options.severityOverrides, options.fhirVersion, artDecorCacheDir);

    if (options.eagerLoad || allDirs.length === 0) {
      // Legacy eager loading
      for (const dir of options.profilesDirs ?? []) {
        await validator.registry.loadFromDirectory(dir);
      }

      for (const dir of options.terminologyDirs ?? []) {
        await validator.terminology.loadFromDirectory(dir);
      }

      return validator;
    }

    // Lazy loading via index
    const index = new FileIndex();
    const cachePath = options.indexCachePath ?? path.join(allDirs[0], '..', '.fhir-index.json');
    const loaded = await index.loadFromCache(cachePath, allDirs);

    if (!loaded) {
      await index.buildFromDirectories(allDirs);
      await index.saveToCache(cachePath).catch(() => { /* ignore write errors */ });
    }

    validator.registry.registerIndex(index.getEntries('StructureDefinition'));
    validator.terminology.registerIndex([
      ...index.getEntries('ValueSet'),
      ...index.getEntries('CodeSystem'),
    ]);

    return validator;
  }

  /**
   * Preload all indexed files into memory using parallel async reads.
   * Call this after create() when you plan to validate many resources (batch mode).
   */
  async preload(): Promise<void> {
    await Promise.all([
      this.registry.preload(),
      this.terminology.preload(),
    ]);
  }

  /**
   * Validate a FHIR resource, optionally against a specific profile.
   * If no profile is specified, the first profile from meta.profile is used
   * or the base FHIR profile.
   */
  async validate(resource: unknown, profileUrl?: string): Promise<ValidationResult> {

    const validationId = randomUUID();
    const timestamp = new Date().toISOString();

    // Step 0: Prototype pollution check
    const protoIssues = this.checkPrototypePollution(resource);

    if (protoIssues.length > 0) {
      return { valid: false, issues: protoIssues, validationId, timestamp };
    }

    // Step 1: Basic structure check
    const structureIssues = this.checkStructure(resource);

    if (structureIssues.length > 0) {
      return { valid: false, issues: structureIssues, validationId, timestamp };
    }

    const res = resource as Record<string, unknown>;

    // Step 1b: FHIR version check
    if (this.fhirVersion) {
      const versionIssues = this.checkFhirVersion(res);

      if (versionIssues.length > 0) {
        return { valid: false, issues: versionIssues, validationId, timestamp };
      }
    }

    // Step 2: Deep structural validation
    const result = await this.structural.validate(res, profileUrl);

    // Apply severity overrides
    if (Object.keys(this.severityOverrides).length > 0) {

      for (const issue of result.issues) {
        if (issue.code && this.severityOverrides[issue.code]) {
          issue.severity = this.severityOverrides[issue.code];
        }
      }

      // Recompute validity after overrides
      const errors = result.issues.filter(i => i.severity === 'error');
      result.valid = errors.length === 0;
    }

    result.validationId = validationId;
    result.timestamp = timestamp;

    return result;
  }

  /**
   * Validate a batch of resources and return a result per resource
   */
  async validateBatch(resources: unknown[]): Promise<ValidationResult[]> {
    return Promise.all(resources.map(r => this.validate(r)));
  }

  /**
   * Check for prototype pollution in parsed JSON input.
   * Scans top-level and nested keys for __proto__, constructor, prototype.
   */
  private checkPrototypePollution(resource: unknown, path = '', depth = 0): ValidationIssue[] {

    if (depth > 20 || !resource || typeof resource !== 'object') {
      return [];
    }

    const issues: ValidationIssue[] = [];

    for (const key of Object.keys(resource as Record<string, unknown>)) {
      if (PROTO_KEYS.has(key)) {
        issues.push({
          severity: 'error',
          path: path ? `${path}.${key}` : key,
          code: 'SECURITY',
          message: `Potentially unsafe key '${key}' detected in resource`
        });
      }

      const val = (resource as Record<string, unknown>)[key];

      if (typeof val === 'object' && val !== null) {
        if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            issues.push(...this.checkPrototypePollution(val[i], `${path ? path + '.' : ''}${key}[${i}]`, depth + 1));
          }
        } else {
          issues.push(...this.checkPrototypePollution(val, path ? `${path}.${key}` : key, depth + 1));
        }
      }
    }

    return issues;
  }

  /**
   * Check if a resource has valid JSON structure for FHIR
   */
  private checkStructure(resource: unknown): ValidationIssue[] {

    const issues: ValidationIssue[] = [];

    if (resource === null || resource === undefined) {
      issues.push({
        severity: 'error', path: '',
        message: 'Resource is null or undefined'
      });

      return issues;
    }

    if (typeof resource !== 'object' || Array.isArray(resource)) {
      issues.push({
        severity: 'error', path: '',
        message: 'Resource must be a JSON object'
      });

      return issues;
    }

    const res = resource as Record<string, unknown>;

    if (!res.resourceType || typeof res.resourceType !== 'string') {
      issues.push({
        severity: 'error', path: 'resourceType',
        message: 'resourceType is required and must be a string'
      });
    }

    return issues;
  }

  /**
   * Check FHIR version compatibility
   */
  private checkFhirVersion(resource: Record<string, unknown>): ValidationIssue[] {

    const meta = resource.meta as { versionId?: string; profile?: string[] } | undefined;

    // Check if meta.tag contains fhirVersion, or check against known R4 resource types
    // For now, we validate that profiles reference the correct FHIR version
    if (meta?.profile) {
      for (const profileUrl of meta.profile) {
        if (typeof profileUrl === 'string' && profileUrl.includes('|')) {
          const version = profileUrl.split('|')[1];

          if (version && this.fhirVersion && !version.startsWith(this.fhirVersion.split('.')[0])) {
            return [{
              severity: 'error',
              path: 'meta.profile',
              code: 'FHIR_VERSION',
              message: `Profile version '${version}' is not compatible with configured FHIR version '${this.fhirVersion}'`
            }];
          }
        }
      }
    }

    return [];
  }

  /**
   * Load terminology credentials from a config file (e.g. config.local.json).
   * Returns null if the file does not exist — safe to call unconditionally.
   */
  static async loadConfig(configPath: string): Promise<{ terminology?: NictizTerminologyConfig } | null> {

    try {
      const content = await readFile(configPath, 'utf8');

      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Register a StructureDefinition programmatically
   */
  registerProfile(sd: unknown): void {
    const profile = sd as Parameters<typeof this.registry.register>[0];
    this.registry.register(profile);
  }

  /**
   * Statistics about loaded profiles and terminology
   */
  stats(): {
    profiles: number;
    valueSets: number;
    codeSystems: number;
    terminologyCacheLookups: number;
  } {
    const termStats = this.terminology.stats();

    return {
      profiles: this.registry.size(),
      ...termStats,
      terminologyCacheLookups: termStats.cachedLookups
    };
  }
}

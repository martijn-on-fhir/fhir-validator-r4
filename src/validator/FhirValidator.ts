// src/validator/FhirValidator.ts
import type { ValidationResult, ValidationIssue } from '../types/fhir';
import { StructureDefinitionRegistry } from '../registry/StructureDefinitionRegistry';
import { TerminologyService, type TerminologyServiceOptions } from '../terminology/TerminologyService';
import { FhirPathEngine } from '../fhirpath/FhirPathEngine';
import { StructuralValidator } from '../structural/StructuralValidator';

export interface FhirValidatorOptions {
  /** Directories with StructureDefinition JSON files (loaded in order) */
  profilesDirs?: string[];
  /** Directories with ValueSet / CodeSystem JSON files (loaded in order) */
  terminologyDirs?: string[];
  /** Options for external terminology server */
  terminology?: TerminologyServiceOptions;
}

export class FhirValidator {
  readonly registry: StructureDefinitionRegistry;
  readonly terminology: TerminologyService;
  readonly fhirPath: FhirPathEngine;
  private structural: StructuralValidator;

  private constructor(options: TerminologyServiceOptions = {}) {
    this.registry = new StructureDefinitionRegistry();
    this.terminology = new TerminologyService(options);
    this.fhirPath = new FhirPathEngine();
    this.structural = new StructuralValidator(
      this.registry,
      this.terminology,
      this.fhirPath
    );
  }

  /**
   * Factory method — loads profiles and terminology for use.
   * Directories are loaded in order (e.g. r4-core first, then nl-core).
   */
  static async create(options: FhirValidatorOptions = {}): Promise<FhirValidator> {
    const validator = new FhirValidator(options.terminology);

    for (const dir of options.profilesDirs ?? []) {
      await validator.registry.loadFromDirectory(dir);
    }

    for (const dir of options.terminologyDirs ?? []) {
      await validator.terminology.loadFromDirectory(dir);
    }

    return validator;
  }

  /**
   * Validate a FHIR resource, optionally against a specific profile.
   * If no profile is specified, the first profile from meta.profile is used
   * or the base FHIR profile.
   */
  async validate(
    resource: unknown,
    profileUrl?: string
  ): Promise<ValidationResult> {

    // Step 1: Basic structure check
    const structureIssues = this.checkStructure(resource);
    if (structureIssues.length > 0) {
      return { valid: false, issues: structureIssues };
    }

    const res = resource as Record<string, unknown>;

    // Step 2: Deep structural validation
    return this.structural.validate(res, profileUrl);
  }

  /**
   * Validate a batch of resources and return a result per resource
   */
  async validateBatch(
    resources: unknown[]
  ): Promise<ValidationResult[]> {
    return Promise.all(resources.map(r => this.validate(r)));
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

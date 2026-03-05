// src/structural/structural-validator.ts
import type {
  StructureDefinition,
  ElementDefinition,
  ElementDefinitionConstraint,
  ValidationIssue,
  ValidationResult,
  Coding,
  BindingStrength
} from '../types/fhir';
import type { StructureDefinitionRegistry } from '../registry/structure-definition-registry';
import type { TerminologyService } from '../terminology/terminology-service';
import type { FhirPathEngine } from '../fhirpath/fhir-path-engine';

type FhirResource = Record<string, unknown>;

export class StructuralValidator {
  constructor(
    private registry: StructureDefinitionRegistry,
    private terminology: TerminologyService,
    private fhirPath: FhirPathEngine
  ) {}

  async validate(
    resource: FhirResource,
    profileUrl?: string
  ): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];

    // Determine which profile to validate against
    const meta = resource.meta as { profile?: string[] } | undefined;
    const url =
      profileUrl ??
      meta?.profile?.[0] ??
      `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;

    const sd = this.registry.resolve(url);
    if (!sd) {
      return {
        valid: false,
        issues: [{
          severity: 'error',
          path: '',
          message: `Profile not found: ${url}. Make sure the StructureDefinition is loaded.`
        }],
        resourceType: resource.resourceType as string,
        profile: url
      };
    }

    const elements = this.registry.resolveElements(sd);

    // Validate root-level elements
    issues.push(...this.validateRequiredFields(resource, sd));

    // Validate each element from the profile
    for (const element of elements) {
      // Skip the root element itself (e.g. "Patient")
      if (!element.path.includes('.')) continue;

      // Compute the path relative to the resource root
      const relPath = element.path.substring(element.path.indexOf('.') + 1);

      // Get the values for this path
      const values = this.fhirPath.getValues(resource, relPath);

      // --- Cardinality ---
      issues.push(...this.validateCardinality(element, values, relPath));

      // --- Per-value validations ---
      for (const value of values) {
        if (value === null || value === undefined) continue;

        // Type validation
        issues.push(...this.validateType(element, value, relPath));

        // Terminology binding
        if (element.binding) {
          const termIssues = await this.validateBinding(element, value, relPath);
          issues.push(...termIssues);
        }

        // Fixed values
        issues.push(...this.validateFixedValues(element, value, relPath));

        // Pattern values
        issues.push(...this.validatePatternValues(element, value, relPath));
      }

      // --- FHIRPath constraints ---
      for (const constraint of element.constraint ?? []) {
        issues.push(
          ...this.validateConstraint(resource, constraint, relPath)
        );
      }
    }

    const errors = issues.filter(i => i.severity === 'error');

    return {
      valid: errors.length === 0,
      issues,
      resourceType: resource.resourceType as string,
      profile: url
    };
  }

  // -------------------------------------------------------
  // Cardinality
  // -------------------------------------------------------

  private validateCardinality(
    element: ElementDefinition,
    values: unknown[],
    path: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const count = values.length;

    if (count < element.min) {
      issues.push({
        severity: 'error',
        path,
        code: 'REQUIRED',
        message: `Field '${path}' is required (min: ${element.min}, found: ${count})`
      });
    }

    if (element.max !== '*') {
      const maxNum = parseInt(element.max, 10);
      if (!isNaN(maxNum) && count > maxNum) {
        issues.push({
          severity: 'error',
          path,
          code: 'MAX_CARDINALITY',
          message: `Too many values for '${path}' (max: ${element.max}, found: ${count})`
        });
      }
    }

    return issues;
  }

  // -------------------------------------------------------
  // Type validation
  // -------------------------------------------------------

  private validateType(
    element: ElementDefinition,
    value: unknown,
    path: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!element.type || element.type.length === 0) return issues;

    // Check if the value matches one of the allowed types
    const typeValid = element.type.some(t => this.checkType(value, t.code));

    if (!typeValid) {
      const expected = element.type.map(t => t.code).join(' | ');
      const actual = typeof value;
      issues.push({
        severity: 'warning',
        path,
        code: 'TYPE_MISMATCH',
        message: `Type mismatch on '${path}': expected ${expected}, found ${actual}`
      });
    }

    return issues;
  }

  private checkType(value: unknown, fhirType: string): boolean {
    switch (fhirType) {
      case 'string':
      case 'code':
      case 'id':
      case 'uri':
      case 'url':
      case 'canonical':
      case 'markdown':
      case 'base64Binary':
      case 'oid':
      case 'uuid':
        return typeof value === 'string';
      case 'boolean':
        return typeof value === 'boolean';
      case 'integer':
      case 'unsignedInt':
      case 'positiveInt':
        return typeof value === 'number' && Number.isInteger(value);
      case 'decimal':
        return typeof value === 'number';
      case 'dateTime':
      case 'date':
      case 'time':
      case 'instant':
        return typeof value === 'string'; // Further pattern validation possible
      case 'Coding':
      case 'CodeableConcept':
      case 'Reference':
      case 'Identifier':
      case 'HumanName':
      case 'Address':
      case 'ContactPoint':
      case 'Period':
      case 'Quantity':
      case 'Range':
      case 'Ratio':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      default:
        // Complex type or unknown: accept objects
        return typeof value === 'object' || typeof value === 'string';
    }
  }

  // -------------------------------------------------------
  // Terminology binding
  // -------------------------------------------------------

  private async validateBinding(
    element: ElementDefinition,
    value: unknown,
    path: string
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const binding = element.binding!;

    // Handle plain `code` / `string` type (e.g. gender: "female")
    if (typeof value === 'string') {
      // Look up the system from the ValueSet
      const system = this.inferSystemFromValueSet(binding.valueSet);
      if (system) {
        const result = await this.terminology.validateCode(
          system, value, binding.valueSet,
          binding.strength as BindingStrength
        );
        if (!result.valid) {
          const severity = binding.strength === 'required' ? 'error' : 'warning';
          issues.push({
            severity, path, code: 'CODE_INVALID',
            message: `Invalid code: '${value}'. ${result.message ?? ''}`
          });
        }
      }
      return issues;
    }

    // Extract codings from Coding / CodeableConcept
    const codings = this.extractCodings(value);
    if (codings.length === 0) return issues;

    for (const coding of codings) {
      if (!coding.system || !coding.code) continue;

      const result = await this.terminology.validateCode(
        coding.system,
        coding.code,
        binding.valueSet,
        binding.strength as BindingStrength
      );

      if (!result.valid) {
        const severity =
          binding.strength === 'required' ? 'error' : 'warning';

        issues.push({
          severity,
          path,
          code: 'CODE_INVALID',
          message: `Invalid code: ${coding.system}|${coding.code}. ${result.message ?? ''}`
        });
      }
    }

    return issues;
  }

  /**
   * Infer the code system from a ValueSet URL for plain code types
   */
  private inferSystemFromValueSet(valueSetUrl?: string): string | undefined {
    if (!valueSetUrl) return undefined;

    // Known mappings from ValueSet URL to system
    const mappings: Record<string, string> = {
      'http://hl7.org/fhir/ValueSet/administrative-gender':
        'http://hl7.org/fhir/administrative-gender',
      'http://hl7.org/fhir/ValueSet/name-use':
        'http://hl7.org/fhir/name-use',
      'http://hl7.org/fhir/ValueSet/address-use':
        'http://hl7.org/fhir/address-use',
      'http://hl7.org/fhir/ValueSet/contact-point-system':
        'http://hl7.org/fhir/contact-point-system',
      'http://hl7.org/fhir/ValueSet/observation-status':
        'http://hl7.org/fhir/observation-status',
    };

    return mappings[valueSetUrl.split('|')[0]];
  }

  private extractCodings(value: unknown): Coding[] {
    if (!value || typeof value !== 'object') return [];
    const v = value as Record<string, unknown>;

    // Direct Coding
    if (typeof v.system === 'string' || typeof v.code === 'string') {
      return [v as unknown as Coding];
    }

    // CodeableConcept
    if (Array.isArray(v.coding)) {
      return v.coding as Coding[];
    }

    return [];
  }

  // -------------------------------------------------------
  // Fixed values
  // -------------------------------------------------------

  private validateFixedValues(
    element: ElementDefinition,
    value: unknown,
    path: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (element.fixedString !== undefined) {
      if (value !== element.fixedString) {
        issues.push({
          severity: 'error', path, code: 'FIXED_VALUE',
          message: `Field '${path}' must be exactly '${element.fixedString}'`
        });
      }
    }

    if (element.fixedCode !== undefined) {
      if (value !== element.fixedCode) {
        issues.push({
          severity: 'error', path, code: 'FIXED_VALUE',
          message: `Code '${path}' must be exactly '${element.fixedCode}'`
        });
      }
    }

    if (element.fixedCoding !== undefined) {
      const coding = value as Coding;
      if (
        coding.system !== element.fixedCoding.system ||
        coding.code !== element.fixedCoding.code
      ) {
        issues.push({
          severity: 'error', path, code: 'FIXED_VALUE',
          message: `Coding '${path}' must be ${element.fixedCoding.system}|${element.fixedCoding.code}`
        });
      }
    }

    return issues;
  }

  // -------------------------------------------------------
  // Pattern values
  // -------------------------------------------------------

  private validatePatternValues(
    element: ElementDefinition,
    value: unknown,
    path: string
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (element.patternCoding) {
      const coding = value as Coding;
      const pattern = element.patternCoding;
      if (pattern.system && coding.system !== pattern.system) {
        issues.push({
          severity: 'error', path, code: 'PATTERN_MISMATCH',
          message: `Coding.system must be '${pattern.system}'`
        });
      }
      if (pattern.code && coding.code !== pattern.code) {
        issues.push({
          severity: 'error', path, code: 'PATTERN_MISMATCH',
          message: `Coding.code must be '${pattern.code}'`
        });
      }
    }

    if (element.patternIdentifier) {
      const identifier = value as Record<string, unknown>;
      const pattern = element.patternIdentifier;
      if (pattern.system && identifier.system !== pattern.system) {
        issues.push({
          severity: 'error', path, code: 'PATTERN_MISMATCH',
          message: `Identifier.system must be '${pattern.system}'`
        });
      }
    }

    return issues;
  }

  // -------------------------------------------------------
  // FHIRPath constraints
  // -------------------------------------------------------

  private validateConstraint(
    resource: object,
    constraint: ElementDefinitionConstraint,
    path: string
  ): ValidationIssue[] {
    const { values, error } = this.fhirPath.evaluate(resource, constraint.expression);

    if (error) {
      return [{
        severity: 'warning',
        path,
        code: constraint.key,
        message: `FHIRPath error [${constraint.key}]: ${error}`,
        expression: constraint.expression
      }];
    }

    // Constraint is valid if result is [true]
    const passed =
      values.length > 0 &&
      !(values.length === 1 && values[0] === false);

    if (!passed) {
      return [{
        severity: constraint.severity,
        path,
        code: constraint.key,
        message: `[${constraint.key}] ${constraint.human}`,
        expression: constraint.expression
      }];
    }

    return [];
  }

  // -------------------------------------------------------
  // Required root-level fields
  // -------------------------------------------------------

  private validateRequiredFields(
    resource: FhirResource,
    sd: StructureDefinition
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (!resource.resourceType) {
      issues.push({
        severity: 'error', path: 'resourceType', code: 'REQUIRED',
        message: 'resourceType is required'
      });
    } else if (resource.resourceType !== sd.type) {
      issues.push({
        severity: 'error', path: 'resourceType', code: 'TYPE_MISMATCH',
        message: `resourceType '${resource.resourceType}' does not match profile for '${sd.type}'`
      });
    }

    return issues;
  }
}

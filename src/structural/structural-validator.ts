import type {FhirPathEngine} from '../fhirpath/fhir-path-engine';
import type {StructureDefinitionRegistry} from '../registry/structure-definition-registry';
import type {TerminologyService} from '../terminology/terminology-service';
import type {StructureDefinition, ElementDefinition, ElementDefinitionConstraint, ValidationIssue, ValidationResult, Coding, BindingStrength} from '../types/fhir';

type FhirResource = Record<string, unknown>;

// FHIR R4 date/time format patterns
const FHIR_DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const FHIR_DATETIME_RE = /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/;
const FHIR_TIME_RE = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const FHIR_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

interface SliceMatchInfo {
  discriminatorType: string;
  discriminatorPath: string;
  matchValue: unknown;
  sliceElement: ElementDefinition;
}

export class StructuralValidator {

  constructor(private registry: StructureDefinitionRegistry, private terminology: TerminologyService, private fhirPath: FhirPathEngine) {
  }

  async validate(resource: FhirResource, profileUrl?: string): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];

    // Determine which profile to validate against
    const meta = resource.meta as { profile?: string[] } | undefined;
    const url = profileUrl ?? meta?.profile?.[0] ?? `http://hl7.org/fhir/StructureDefinition/${resource.resourceType}`;

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

    // Build slice matching info
    const sliceMap = this.buildSliceMap(elements);

    // Validate each element from the profile
    for (const element of elements) {
      // Skip the root element itself (e.g. "Patient")
      if (!element.path.includes('.')) {
        continue;
      }

      // Compute the path relative to the resource root
      const relPath = element.path.substring(element.path.indexOf('.') + 1);
      const elementId = element.id ?? '';

      if (this.hasSliceContext(elementId)) {
        // --- Slice-aware validation ---
        issues.push(
          ...await this.validateSlicedElement(resource, element, relPath, sliceMap)
        );
      } else {
        // --- Non-sliced validation (existing logic) ---
        const values = this.fhirPath.getValues(resource, relPath);

        issues.push(...this.validateCardinality(element, values, relPath, resource));

        for (const value of values) {
          if (value === null || value === undefined) {
            continue;
          }

          issues.push(...this.validateType(element, value, relPath));

          if (element.binding) {
            issues.push(...await this.validateBinding(element, value, relPath));
          }

          issues.push(...this.validateFixedValues(element, value, relPath));
          issues.push(...this.validatePatternValues(element, value, relPath));
        }

        // FHIRPath constraints only apply when the element is present or required
        if (values.length > 0 || element.min > 0) {
          for (const constraint of element.constraint ?? []) {
            issues.push(...this.validateConstraint(resource, constraint, relPath));
          }
        }
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
  // Slicing
  // -------------------------------------------------------

  /**
   * Build a map of slice element ids to their matching info.
   * For each slice, determines how to match resource instances
   * using the parent's discriminator definition.
   */
  private buildSliceMap(elements: ElementDefinition[]): Map<string, SliceMatchInfo> {

    const map = new Map<string, SliceMatchInfo>();

    // Collect elements that define slicing
    const slicingDefs = new Map<string, ElementDefinition>();

    for (const el of elements) {
      if (el.slicing && el.id) {
        slicingDefs.set(el.id, el);
      }
    }

    for (const el of elements) {
      if (!el.sliceName || !el.id) {
        continue;
      }

      // Find the parent element that defines slicing
      const parentId = this.getSliceParentId(el.id);
      const parentEl = slicingDefs.get(parentId);
      const disc = parentEl?.slicing?.discriminator?.[0];

      if (!disc) {
        continue;
      }

      let matchValue: unknown;

      if (disc.type === 'value') {
        if (disc.path === 'url') {
          // Extension slicing: look for fixedUri on child .url element
          const urlChild = elements.find(e => e.id === el.id + '.url');
          matchValue = urlChild?.fixedUri;
        } else if (disc.path === '$this') {
          // Pattern on the slice element itself
          matchValue = el.patternIdentifier || el.patternCoding || el.patternCodeableConcept;
        } else {
          // Match by a specific field (use, system, code, etc.)
          // Check for fixed value on the child element
          const child = elements.find(e => e.id === el.id + '.' + disc.path);
          matchValue = child?.fixedCode ?? child?.fixedString ?? child?.fixedUri;

          // Fallback: check for pattern on the slice element itself
          if (matchValue === undefined) {
            matchValue = this.getNestedValue(
              el as unknown as Record<string, unknown>, disc.path
            );
          }
        }
      } else if (disc.type === 'type' && disc.path === '$this') {
        // Match by type
        matchValue = el.type?.[0]?.code;
      } else if (disc.type === 'pattern') {
        if (disc.path === '$this') {
          matchValue = el.patternCoding || el.patternCodeableConcept || el.patternIdentifier;
        }
      }
      // 'profile' and 'exists' discriminators: matchValue stays undefined → accept all

      map.set(el.id, {
        discriminatorType: disc.type,
        discriminatorPath: disc.path,
        matchValue,
        sliceElement: el,
      });
    }

    return map;
  }

  /**
   * Check if an element id contains slice context (has ':' in segments after the resource type).
   */
  private hasSliceContext(elementId: string): boolean {

    const dotIdx = elementId.indexOf('.');

    if (dotIdx < 0) {
      return false;
    }

    return elementId.substring(dotIdx + 1).includes(':');
  }

  /**
   * Get the parent element id for a slice.
   * e.g., "Patient.extension:nationality" → "Patient.extension"
   * e.g., "Patient.extension:nationality.extension:code" → "Patient.extension:nationality.extension"
   */
  private getSliceParentId(sliceId: string): string {

    const parts = sliceId.split('.');

    for (let i = parts.length - 1; i >= 0; i--) {
      const colonIdx = parts[i].indexOf(':');

      if (colonIdx >= 0) {
        parts[i] = parts[i].substring(0, colonIdx);

        return parts.slice(0, i + 1).join('.');
      }
    }

    return sliceId;
  }

  /**
   * Resolve parent instances by walking the element id through the slice hierarchy.
   * Returns the instances that are the immediate parents of the last segment in the id.
   */
  private resolveParentsAtId(resource: FhirResource, elementId: string, sliceMap: Map<string, SliceMatchInfo>): unknown[] {

    const parts = elementId.split('.');
    // parts[0] is the resource type, skip it
    // Walk parts[1..n-2] to resolve parents (stop before the last part)

    let instances: unknown[] = [resource];
    let idSoFar = parts[0];

    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i];
      const {field, slice} = this.parseIdPart(part);

      // Get field values from current instances
      const next: unknown[] = [];

      for (const inst of instances) {
        if (typeof inst !== 'object' || inst === null) {
          continue;
        }

        next.push(...this.getFieldValues(inst as Record<string, unknown>, field));
      }

      if (slice) {
        // Filter by slice discriminator
        const sliceId = idSoFar + '.' + part;
        const matchInfo = sliceMap.get(sliceId);

        if (matchInfo && matchInfo.matchValue !== undefined) {
          instances = next.filter(inst => this.matchesDiscriminator(inst, matchInfo));
        } else {
          instances = next;
        }
      } else {
        instances = next;
      }

      idSoFar += '.' + part;
    }

    return instances;
  }

  /**
   * Validate a single element that is within a slice context.
   */
  private async validateSlicedElement(resource: FhirResource, element: ElementDefinition, relPath: string, sliceMap: Map<string, SliceMatchInfo>): Promise<ValidationIssue[]> {

    const issues: ValidationIssue[] = [];
    const elementId = element.id ?? '';

    // Resolve parent instances through the slice chain
    const parents = this.resolveParentsAtId(resource, elementId, sliceMap);

    if (parents.length === 0) {
      return issues;
    } // No matching parents → skip

    const lastPart = elementId.split('.').pop() ?? '';
    const {field: lastField, slice: lastSlice} = this.parseIdPart(lastPart);

    for (const parent of parents) {
      if (typeof parent !== 'object' || parent === null) {
        continue;
      }

      let children = this.getFieldValues(parent as Record<string, unknown>, lastField);

      // If this element defines a slice, filter children by discriminator
      if (element.sliceName && lastSlice) {
        const matchInfo = sliceMap.get(elementId);

        if (matchInfo && matchInfo.matchValue !== undefined) {
          children = children.filter(c => this.matchesDiscriminator(c, matchInfo));
        }
      }

      // Cardinality check per parent
      issues.push(...this.checkCardinalityCounts(element, children.length, relPath));

      // Per-value validations (skip for slice definition elements themselves — children handle these)
      if (!element.sliceName) {
        for (const value of children) {
          if (value === null || value === undefined) {
            continue;
          }

          issues.push(...this.validateType(element, value, relPath));

          if (element.binding) {
            issues.push(...await this.validateBinding(element, value, relPath));
          }

          issues.push(...this.validateFixedValues(element, value, relPath));
          issues.push(...this.validatePatternValues(element, value, relPath));
        }
      }
    }

    return issues;
  }

  /**
   * Check if a resource instance matches a slice discriminator.
   */
  private matchesDiscriminator(instance: unknown, matchInfo: SliceMatchInfo): boolean {

    if (typeof instance !== 'object' || instance === null) {
      return false;
    }

    const obj = instance as Record<string, unknown>;

    switch (matchInfo.discriminatorType) {

      case 'value':
        if (matchInfo.discriminatorPath === 'url') {
          return obj.url === matchInfo.matchValue;
        }

        if (matchInfo.discriminatorPath === '$this') {
          return this.matchesPattern(obj, matchInfo.matchValue);
        }

        // Nested paths like "code.coding.system"
        if (matchInfo.discriminatorPath.includes('.')) {
          const actual = this.getNestedValue(obj, matchInfo.discriminatorPath);

          return actual === matchInfo.matchValue;
        }

        return obj[matchInfo.discriminatorPath] === matchInfo.matchValue;

      case 'type':
        if (matchInfo.discriminatorPath === '$this') {
          return this.checkType(instance, matchInfo.matchValue as string);
        }

        return true;

      case 'pattern':
        if (matchInfo.discriminatorPath === '$this') {
          return this.matchesPattern(obj, matchInfo.matchValue);
        }

        return true;

      default:
        // 'profile', 'exists': not implemented, accept all
        return true;
    }
  }

  /**
   * Check if an instance matches a pattern (all keys in pattern must match).
   */
  private matchesPattern(instance: Record<string, unknown>, pattern: unknown): boolean {

    if (!pattern || typeof pattern !== 'object') {
      return false;
    }

    const p = pattern as Record<string, unknown>;

    for (const key of Object.keys(p)) {
      if (instance[key] !== p[key]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Navigate a dot-separated path into an object.
   * If an array is encountered, takes the first element.
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) {
        return undefined;
      }

      current = (current as Record<string, unknown>)[part];

      if (Array.isArray(current)) {
        current = current[0];
      }
    }

    return current;
  }

  /**
   * Parse an id segment into field name and optional slice name.
   * e.g., "extension:nationality" → {field: "extension", slice: "nationality"}
   * e.g., "url" → {field: "url"}
   */
  private parseIdPart(part: string): { field: string; slice?: string } {
    const colonIdx = part.indexOf(':');

    if (colonIdx >= 0) {
      return {field: part.substring(0, colonIdx), slice: part.substring(colonIdx + 1)};
    }

    return {field: part};
  }

  // -------------------------------------------------------
  // Field value extraction
  // -------------------------------------------------------

  /**
   * Get child values from a parent object for a given field.
   * Handles value[x] and other [x] choice types.
   */
  private getFieldValues(parent: Record<string, unknown>, field: string): unknown[] {

    // Handle choice types like value[x], deceased[x]
    if (field.endsWith('[x]')) {
      const prefix = field.replace('[x]', '');

      for (const key of Object.keys(parent)) {
        if (key.startsWith(prefix) && key.length > prefix.length) {
          const val = parent[key];

          if (val !== undefined && val !== null) {
            return Array.isArray(val) ? val : [val];
          }
        }
      }

      return [];
    }

    const val = parent[field];

    if (val === undefined || val === null) {
      return [];
    }

    if (Array.isArray(val)) {
      return val;
    }

    return [val];
  }

  // -------------------------------------------------------
  // Cardinality
  // -------------------------------------------------------

  private validateCardinality(element: ElementDefinition, values: unknown[], path: string, resource: FhirResource): ValidationIssue[] {

    const parts = path.split('.');

    // For top-level elements, validate globally
    if (parts.length === 1) {
      return this.checkCardinalityCounts(element, values.length, path);
    }

    // For nested elements, validate per parent instance
    const parentPath = parts.slice(0, -1).join('.');
    const childKey = parts[parts.length - 1];
    const parents = this.fhirPath.getValues(resource, parentPath);

    // If no parent instances exist, skip — parent is optional and absent
    if (parents.length === 0) {
      return [];
    }

    const issues: ValidationIssue[] = [];

    for (const parent of parents) {
      if (typeof parent !== 'object' || parent === null) {
        continue;
      }

      const childCount = this.getFieldValues(parent as Record<string, unknown>, childKey).length;
      issues.push(...this.checkCardinalityCounts(element, childCount, path));
    }

    return issues;
  }

  private checkCardinalityCounts(element: ElementDefinition, count: number, path: string): ValidationIssue[] {

    const issues: ValidationIssue[] = [];

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

  private validateType(element: ElementDefinition, value: unknown, path: string): ValidationIssue[] {

    const issues: ValidationIssue[] = [];

    if (!element.type || element.type.length === 0) {
      return issues;
    }

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
      case 'date':
        return typeof value === 'string' && FHIR_DATE_RE.test(value);
      case 'dateTime':
        return typeof value === 'string' && FHIR_DATETIME_RE.test(value);
      case 'time':
        return typeof value === 'string' && FHIR_TIME_RE.test(value);
      case 'instant':
        return typeof value === 'string' && FHIR_INSTANT_RE.test(value);
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

  private async validateBinding(element: ElementDefinition, value: unknown, path: string): Promise<ValidationIssue[]> {

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
            message: `Invalid code value for '${path}'. ${result.message ?? ''}`
          });
        }
      }

      return issues;
    }

    // Extract codings from Coding / CodeableConcept
    const codings = this.extractCodings(value);

    if (codings.length === 0) {
      return issues;
    }

    for (const coding of codings) {
      if (!coding.system || !coding.code) {
        continue;
      }

      const result = await this.terminology.validateCode(
        coding.system,
        coding.code,
        binding.valueSet,
        binding.strength as BindingStrength
      );

      if (!result.valid) {

        const severity =  binding.strength === 'required' ? 'error' : 'warning';

        issues.push({
          severity,
          path,
          code: 'CODE_INVALID',
          message: `Invalid code for '${path}'. ${result.message ?? ''}`
        });
      }
    }

    return issues;
  }

  /**
   * Infer the code system from a ValueSet URL for plain code types.
   * Uses dynamic lookup from loaded ValueSets, with known mappings as fallback.
   */
  private inferSystemFromValueSet(valueSetUrl?: string): string | undefined {
    if (!valueSetUrl) {
      return undefined;
    }

    // Dynamic: look up from loaded ValueSets
    const dynamic = this.terminology.inferSystemFromValueSet(valueSetUrl);

    if (dynamic) {
      return dynamic;
    }

    // Static fallback for common FHIR ValueSets
    const mappings: Record<string, string> = {
      'http://hl7.org/fhir/ValueSet/administrative-gender': 'http://hl7.org/fhir/administrative-gender',
      'http://hl7.org/fhir/ValueSet/name-use': 'http://hl7.org/fhir/name-use',
      'http://hl7.org/fhir/ValueSet/address-use': 'http://hl7.org/fhir/address-use',
      'http://hl7.org/fhir/ValueSet/contact-point-system': 'http://hl7.org/fhir/contact-point-system',
      'http://hl7.org/fhir/ValueSet/observation-status': 'http://hl7.org/fhir/observation-status',
    };

    return mappings[valueSetUrl.split('|')[0]];
  }

  private extractCodings(value: unknown): Coding[] {

    if (!value || typeof value !== 'object') {
      return [];
    }

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

  private validateFixedValues(element: ElementDefinition, value: unknown, path: string): ValidationIssue[] {

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

    if (element.fixedUri !== undefined) {
      if (value !== element.fixedUri) {
        issues.push({
          severity: 'error', path, code: 'FIXED_VALUE',
          message: `URI '${path}' must be exactly '${element.fixedUri}'`
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

  private validatePatternValues(element: ElementDefinition, value: unknown, path: string): ValidationIssue[] {

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

  private validateConstraint(resource: object, constraint: ElementDefinitionConstraint, path: string): ValidationIssue[] {

    const {values, error} = this.fhirPath.evaluate(resource, constraint.expression);

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

  private validateRequiredFields(resource: FhirResource, sd: StructureDefinition): ValidationIssue[] {

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

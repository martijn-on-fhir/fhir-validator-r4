// src/fhirpath/fhir-path-engine.ts
import fhirpath, {type Model} from 'fhirpath';

// Try to load the R4 model
let r4Model: Model | undefined;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  r4Model = require('fhirpath/fhir-context/r4') as Model;
} catch {
  r4Model = undefined;
}

export interface FhirPathResult {
  values: unknown[];
  error?: string;
}

export class FhirPathEngine {

  /** Per-validation cache for getValues() calls, keyed by path */
  private valuesCache: Map<string, unknown[]> | null = null;
  private valuesCacheResource: object | null = null;

  /**
   * Enable per-resource caching for getValues().
   * Call clearCache() after each validation to prevent stale results.
   */
  enableCache(resource: object): void {
    this.valuesCache = new Map();
    this.valuesCacheResource = resource;
  }

  clearCache(): void {
    this.valuesCache = null;
    this.valuesCacheResource = null;
  }

  /**
   * Evaluate a FHIRPath expression on a resource.
   * Does not throw — returns an empty result with error string.
   */
  evaluate(resource: object, expression: string, context?: object): FhirPathResult {
    try {
      const values = fhirpath.evaluate(
        resource,
        expression,
        context ?? undefined,
        r4Model
      ) as unknown[];

      return {values};

    } catch (e) {

      return {
        values: [],
        error: `FHIRPath evaluation error in "${expression}": ${(e as Error).message}`
      };
    }
  }

  /**
   * Evaluate a boolean FHIRPath constraint.
   * Returns true if the result is [true] or a non-empty list.
   */
  isTruthy(resource: object, expression: string, context?: object): boolean {

    const {values} = this.evaluate(resource, expression, context);

    if (values.length === 0) {
      return false;
    }

    if (values.length === 1 && values[0] === false) {
      return false;
    }

    if (values.length === 1 && values[0] === true) {
      return true;
    }

    // Non-empty list of nodes = true
    return values.length > 0;
  }

  /**
   * Get all values for a path (e.g. "name.family")
   */
  getValues(resource: object, path: string): unknown[] {

    if (!path) {
      return [resource];
    }

    // Use cache when evaluating against the cached root resource
    if (this.valuesCache && resource === this.valuesCacheResource) {
      const cached = this.valuesCache.get(path);

      if (cached) {
        return cached;
      }
    }

    const {values} = this.evaluate(resource, path);
    const result = values.flat().filter(v => v !== null && v !== undefined);

    if (this.valuesCache && resource === this.valuesCacheResource) {
      this.valuesCache.set(path, result);
    }

    return result;
  }

  /**
   * Evaluate an expression as a single path for a resource
   * and return the values as an array of objects
   */
  getNodes(resource: object, path: string): object[] {

    const values = this.getValues(resource, path);

    return values.filter((v): v is object => typeof v === 'object' && v !== null);
  }
}

// src/fhirpath/FhirPathEngine.ts
import fhirpath, { type Model } from 'fhirpath';

// Try to load the R4 model
let r4Model: Model | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  r4Model = require('fhirpath/fhir-context/r4') as Model;
} catch {
  r4Model = undefined;
}

export interface FhirPathResult {
  values: unknown[];
  error?: string;
}

export class FhirPathEngine {

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
      return { values };
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
    const { values } = this.evaluate(resource, expression, context);
    if (values.length === 0) return false;
    if (values.length === 1 && values[0] === false) return false;
    if (values.length === 1 && values[0] === true) return true;
    // Non-empty list of nodes = true
    return values.length > 0;
  }

  /**
   * Get all values for a path (e.g. "name.family")
   */
  getValues(resource: object, path: string): unknown[] {
    if (!path) return [resource];
    const { values } = this.evaluate(resource, path);
    return values.flat().filter(v => v !== null && v !== undefined);
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

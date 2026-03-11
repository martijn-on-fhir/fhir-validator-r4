// src/sources/resource-source.ts

/**
 * Abstraction for loading FHIR conformance resources (StructureDefinition, ValueSet, CodeSystem)
 * from any backend (filesystem, MongoDB, REST API, etc.).
 */
export interface ResourceSource {
  /** Load all conformance resources from this source. */
  loadAll(): Promise<Record<string, unknown>[]>;
  /** Persist a resource back to this source (e.g. cache an externally resolved ValueSet). */
  save?(resource: Record<string, unknown>): Promise<void>;
}
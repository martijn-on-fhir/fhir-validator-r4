// src/index.ts
export { FhirValidator, type FhirValidatorOptions, type SeverityOverrides } from './validator/fhir-validator';
export { StructureDefinitionRegistry } from './registry/structure-definition-registry';
export { TerminologyService, type TerminologyServiceOptions } from './terminology/terminology-service';
export { NictizTerminologyClient, type NictizTerminologyConfig } from './terminology/nictiz-terminology-client';
export { FhirPathEngine } from './fhirpath/fhir-path-engine';
export { StructuralValidator } from './structural/structural-validator';
export type {
  ValidationResult,
  ValidationIssue,
  IssueSeverity,
  StructureDefinition,
  ElementDefinition,
  ValueSet,
  CodeSystem,
  CodeValidationResult
} from './types/fhir';

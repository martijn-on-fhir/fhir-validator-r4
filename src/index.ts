// src/index.ts
export { FhirValidator } from './validator/fhir-validator';
export { StructureDefinitionRegistry } from './registry/structure-definition-registry';
export { TerminologyService } from './terminology/terminology-service';
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

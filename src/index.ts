// src/index.ts
export { FhirValidator } from './validator/FhirValidator';
export { StructureDefinitionRegistry } from './registry/StructureDefinitionRegistry';
export { TerminologyService } from './terminology/TerminologyService';
export { FhirPathEngine } from './fhirpath/FhirPathEngine';
export { StructuralValidator } from './structural/StructuralValidator';
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

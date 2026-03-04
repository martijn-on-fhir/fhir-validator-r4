// src/types/fhir.ts
// Core FHIR R4 type definitions

export type FhirPrimitive = string | number | boolean;

export interface FhirElement {
  id?: string;
  extension?: Extension[];
}

export interface Extension extends FhirElement {
  url: string;
  valueString?: string;
  valueBoolean?: boolean;
  valueInteger?: number;
  valueCode?: string;
  valueCoding?: Coding;
  valueCodeableConcept?: CodeableConcept;
  valueReference?: Reference;
}

export interface Coding extends FhirElement {
  system?: string;
  version?: string;
  code?: string;
  display?: string;
  userSelected?: boolean;
}

export interface CodeableConcept extends FhirElement {
  coding?: Coding[];
  text?: string;
}

export interface Reference extends FhirElement {
  reference?: string;
  type?: string;
  display?: string;
}

export interface Identifier extends FhirElement {
  use?: string;
  type?: CodeableConcept;
  system?: string;
  value?: string;
}

export interface HumanName extends FhirElement {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
}

export interface Meta extends FhirElement {
  versionId?: string;
  lastUpdated?: string;
  source?: string;
  profile?: string[];
  security?: Coding[];
  tag?: Coding[];
}

// ---- StructureDefinition types ----

export type BindingStrength = 'required' | 'extensible' | 'preferred' | 'example';

export interface ElementDefinitionType {
  code: string;
  profile?: string[];
  targetProfile?: string[];
}

export interface ElementDefinitionBinding {
  strength: BindingStrength;
  description?: string;
  valueSet?: string;
}

export interface ElementDefinitionConstraint {
  key: string;
  requirements?: string;
  severity: 'error' | 'warning';
  human: string;
  expression: string; // FHIRPath
  xpath?: string;
  source?: string;
}

export interface ElementDefinitionSlicing {
  discriminator: Array<{
    type: 'value' | 'exists' | 'pattern' | 'type' | 'profile';
    path: string;
  }>;
  description?: string;
  ordered?: boolean;
  rules: 'closed' | 'open' | 'openAtEnd';
}

export interface ElementDefinition {
  id?: string;
  path: string;
  sliceName?: string;
  min: number;
  max: string; // "0", "1", "*"
  type?: ElementDefinitionType[];
  binding?: ElementDefinitionBinding;
  constraint?: ElementDefinitionConstraint[];
  slicing?: ElementDefinitionSlicing;
  // Fixed / pattern values
  fixedString?: string;
  fixedCode?: string;
  fixedUri?: string;
  fixedCoding?: Coding;
  fixedCodeableConcept?: CodeableConcept;
  patternCoding?: Coding;
  patternCodeableConcept?: CodeableConcept;
  patternIdentifier?: Identifier;
  // Must be supported
  mustSupport?: boolean;
  isModifier?: boolean;
}

export interface StructureDefinition {
  resourceType: 'StructureDefinition';
  id?: string;
  url: string;
  name: string;
  title?: string;
  status: string;
  kind: 'primitive-type' | 'complex-type' | 'resource' | 'logical';
  abstract: boolean;
  type: string;
  baseDefinition?: string;
  snapshot?: { element: ElementDefinition[] };
  differential?: { element: ElementDefinition[] };
}

// ---- ValueSet / CodeSystem types ----

export interface ValueSetConcept {
  code: string;
  display?: string;
  definition?: string;
}

export interface ValueSetFilter {
  property: string;
  op: string;
  value: string;
}

export interface ValueSetInclude {
  system?: string;
  version?: string;
  concept?: ValueSetConcept[];
  filter?: ValueSetFilter[];
  valueSet?: string[];
}

export interface ValueSet {
  resourceType: 'ValueSet';
  url: string;
  name?: string;
  title?: string;
  status: string;
  compose?: {
    include: ValueSetInclude[];
    exclude?: ValueSetInclude[];
  };
  expansion?: {
    contains: Array<{ system: string; code: string; display?: string }>;
  };
}

export interface CodeSystemConcept {
  code: string;
  display?: string;
  definition?: string;
  concept?: CodeSystemConcept[]; // Hierarchy
}

export interface CodeSystem {
  resourceType: 'CodeSystem';
  url: string;
  name?: string;
  status: string;
  content: 'not-present' | 'example' | 'fragment' | 'complete' | 'supplement';
  concept?: CodeSystemConcept[];
}

// ---- Validation result types ----

export type IssueSeverity = 'error' | 'warning' | 'information';

export interface ValidationIssue {
  severity: IssueSeverity;
  path: string;
  message: string;
  expression?: string; // The FHIRPath expression that failed
  code?: string;       // Constraint key or error code
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  resourceType?: string;
  profile?: string;
}

export interface CodeValidationResult {
  valid: boolean;
  display?: string;
  message?: string;
}

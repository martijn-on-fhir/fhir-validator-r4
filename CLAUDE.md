# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FHIR Validator for Mexico (fhir-validator-mx) — a TypeScript/Node.js project for validating FHIR (Fast Healthcare Interoperability Resources) data against Mexican healthcare standards.

## Build & Development

- **Package manager:** npm
- **Language:** TypeScript (strict mode, target ES2020, CommonJS modules)
- **Entry point:** `dist/index.js` (compiled from `src/index.ts`)
- **Build:** `npm run build` — compiles TypeScript to `dist/`
- **Test:** `npm test` — runs Jest with ts-jest
- **Dev:** `npm run dev` — runs via ts-node
- **Lint:** `npm run lint` — ESLint on src/

## Architecture

```
src/
  index.ts                          — Public exports
  types/fhir.ts                     — Core FHIR R4 type definitions
  fhirpath/fhir-path-engine.ts        — FHIRPath expression evaluator (wraps fhirpath lib)
  registry/structure-definition-registry.ts — Loads & resolves StructureDefinition profiles
  terminology/terminology-service.ts — Validates codes against ValueSets/CodeSystems
  structural/structural-validator.ts — Core validation: cardinality, types, bindings, constraints
  validator/fhir-validator.ts        — Public facade with factory create() method
tests/
  validator.test.ts                 — Unit tests
```

### Key Design: Multi-Directory Loading

`FhirValidatorOptions` accepts arrays for profile and terminology directories:

```typescript
FhirValidator.create({
  profilesDirs: ['profiles/r4-core', 'profiles/nl-core'],
  terminologyDirs: ['terminology/r4-core', 'terminology/nl-core'],
});
```

Directories are loaded in order — base definitions first, profiles/overlays second. Both `StructureDefinitionRegistry` and `TerminologyService` load recursively from subdirectories.

## Data Layout

```
profiles/r4-core/     — Base FHIR R4 StructureDefinitions
profiles/nl-core/     — nl-core profile overlays
terminology/r4-core/  — Base FHIR R4 ValueSets and CodeSystems
terminology/nl-core/  — nl-core terminology
```

# fhir-validator-mx

A TypeScript/Node.js library for validating FHIR R4 resources against StructureDefinition profiles, with support for Mexican healthcare standards.

## Features

- **Profile-based validation** — validate resources against FHIR StructureDefinition profiles (snapshot and differential)
- **Cardinality checks** — enforces min/max element constraints
- **Type validation** — verifies FHIR primitive and complex types
- **Terminology binding** — validates codes against ValueSets and CodeSystems (local + optional external tx server)
- **FHIRPath constraints** — evaluates FHIRPath invariant expressions
- **Fixed & pattern value checks** — enforces fixedCoding, patternIdentifier, etc.
- **Multi-directory loading** — load profiles and terminology from multiple directories in order (base first, overlays second)
- **Recursive directory scanning** — automatically discovers `.json` files in nested subdirectories
- **Batch validation** — validate multiple resources in a single call

## Installation

```bash
npm install
```

## Quick Start

```typescript
import { FhirValidator } from 'fhir-validator-mx';

// Load profiles and terminology from directories
const validator = await FhirValidator.create({
  profilesDirs: ['profiles/r4-core', 'profiles/nl-core'],
  terminologyDirs: ['terminology/r4-core', 'terminology/nl-core'],
});

// Validate a resource
const result = await validator.validate({
  resourceType: 'Patient',
  identifier: [{ system: 'urn:oid:2.16.840.1.113883.4.629', value: 'CURP123456ABCDEF01' }],
  name: [{ family: 'Garcia', given: ['Maria'] }],
  gender: 'female',
});

console.log(result.valid);  // true or false
console.log(result.issues); // array of ValidationIssue
```

### Programmatic Registration

You can also register profiles and terminology at runtime without loading from disk:

```typescript
const validator = await FhirValidator.create();

validator.registerProfile({
  resourceType: 'StructureDefinition',
  url: 'http://example.org/fhir/StructureDefinition/MyPatient',
  name: 'MyPatient',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Patient',
  snapshot: { element: [/* ... */] },
});

validator.terminology.registerValueSet({
  resourceType: 'ValueSet',
  url: 'http://hl7.org/fhir/ValueSet/administrative-gender',
  status: 'active',
  compose: { include: [/* ... */] },
});
```

## API

### `FhirValidator.create(options?)`

Factory method that creates a validator and loads profiles/terminology.

| Option | Type | Description |
|---|---|---|
| `profilesDirs` | `string[]` | Directories containing StructureDefinition JSON files |
| `terminologyDirs` | `string[]` | Directories containing ValueSet/CodeSystem JSON files |
| `terminology.externalTxServer` | `string` | External terminology server URL (e.g. `https://tx.fhir.org/r4`) |
| `terminology.externalTimeoutMs` | `number` | Timeout for external calls (default: 5000) |

### `validator.validate(resource, profileUrl?)`

Returns a `ValidationResult`:

```typescript
interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  resourceType?: string;
  profile?: string;
}

interface ValidationIssue {
  severity: 'error' | 'warning' | 'information';
  path: string;
  message: string;
  code?: string;
  expression?: string;
}
```

### `validator.validateBatch(resources)`

Validates an array of resources in parallel.

### `validator.stats()`

Returns counts of loaded profiles, ValueSets, CodeSystems, and cached terminology lookups.

## Directory Layout

```
profiles/r4-core/     — Base FHIR R4 StructureDefinitions
profiles/nl-core/     — Profile overlays
terminology/r4-core/  — Base FHIR R4 ValueSets and CodeSystems
terminology/nl-core/  — Additional terminology
```

Directories are loaded in order — base definitions first so that profile overlays can inherit from them.

## Development

```bash
npm run build    # Compile TypeScript to dist/
npm test         # Run tests
npm run dev      # Run via ts-node
```

## License

ISC

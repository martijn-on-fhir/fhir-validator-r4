# fhir-validator-mx

A TypeScript/Node.js library for validating FHIR R4 resources against StructureDefinition profiles, with support for Dutch (nl-core) healthcare standards and the Nictiz terminologieserver.

## Features

- **Profile-based validation** — validate resources against FHIR StructureDefinition profiles (snapshot and differential)
- **Cardinality checks** — enforces min/max element constraints
- **Type validation** — verifies FHIR primitive and complex types including date/dateTime/instant/time format validation
- **Terminology binding** — validates codes against ValueSets and CodeSystems (local + Nictiz + optional external tx server)
- **Nictiz terminologieserver** — OAuth2 integration with the Dutch national terminology server for SNOMED CT NL validation
- **FHIRPath constraints** — evaluates FHIRPath invariant expressions
- **Slicing support** — handles discriminated slicing (value, type, pattern discriminators)
- **Fixed & pattern value checks** — enforces fixedCoding, patternIdentifier, etc.
- **Multi-directory loading** — load profiles and terminology from multiple directories in order (base first, overlays second)
- **BSN elfproef** — validates Dutch citizen service numbers using the 11-test algorithm
- **Security** — prototype pollution detection, error message sanitization (no PHI leakage)
- **Configurable severity** — override issue severity per code (e.g. downgrade CODE_INVALID to warning)
- **FHIR version check** — reject resources with incompatible FHIR version in meta.profile
- **Rate limiting** — sliding window rate limit on external terminology calls
- **Batch validation** — validate multiple resources in a single call
- **Validation metadata** — each result includes a unique `validationId` (UUID) and `timestamp`

## Validation Flow

![Validation Flow](docs/validation-flow.svg)

## Installation

```bash
npm install
```

## Quick Start

```typescript
import { FhirValidator } from 'fhir-validator-mx';

const validator = await FhirValidator.create({
  profilesDirs: ['profiles/r4-core', 'profiles/nl-core'],
  terminologyDirs: ['terminology/r4-core', 'terminology/nl-core'],
});

const result = await validator.validate({
  resourceType: 'Patient',
  identifier: [{ system: 'http://fhir.nl/fhir/NamingSystem/bsn', value: '999911120' }],
  name: [{ family: 'Jansen', given: ['Jan'] }],
  gender: 'male',
});

console.log(result.valid);        // true or false
console.log(result.validationId); // "a1b2c3d4-..."
console.log(result.issues);      // ValidationIssue[]
```

### With Nictiz Terminologieserver

The validator can fall back to the Dutch national terminology server for codes that can't be validated locally (e.g. SNOMED CT codes referenced by broad ValueSets like `observation-codes`).

```typescript
const config = await FhirValidator.loadConfig('config.local.json');

const validator = await FhirValidator.create({
  profilesDirs: ['profiles/r4-core', 'profiles/nl-core'],
  terminologyDirs: ['terminology/r4-core', 'terminology/nl-core'],
  terminology: {
    nictiz: config?.terminology,
  },
});
```

Copy `config.example.json` to `config.local.json` and fill in your Nictiz credentials. This file is gitignored.

### Severity Overrides

```typescript
const validator = await FhirValidator.create({
  profilesDirs: ['profiles/r4-core'],
  terminologyDirs: ['terminology/r4-core'],
  severityOverrides: {
    CODE_INVALID: 'warning', // downgrade binding errors to warnings
  },
});
```

### Programmatic Registration

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
| `terminology.nictiz` | `NictizTerminologyConfig` | Nictiz terminologieserver credentials |
| `terminology.externalTxServer` | `string` | External terminology server URL (e.g. `https://tx.fhir.org/r4`) |
| `terminology.externalTimeoutMs` | `number` | Timeout for external calls (default: 5000) |
| `terminology.externalRateLimit` | `number` | Max external requests per minute (default: 30) |
| `terminology.disableExternalCalls` | `boolean` | Block all external terminology calls |
| `severityOverrides` | `Record<string, IssueSeverity>` | Override severity per issue code |
| `fhirVersion` | `string` | Accepted FHIR version (e.g. `"4.0.1"`) |

### `FhirValidator.loadConfig(path)`

Loads terminology credentials from a JSON file. Returns `null` if the file does not exist.

### `validator.validate(resource, profileUrl?)`

Returns a `ValidationResult`:

```typescript
interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  resourceType?: string;
  profile?: string;
  validationId?: string;
  timestamp?: string;
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

Returns counts of loaded profiles, ValueSets, CodeSystems, cached terminology lookups, and whether Nictiz is configured.

## Terminology Validation Cascade

When validating a code, the terminology service uses the following cascade:

1. **Local ValueSet** — check expansion or compose against locally loaded ValueSets
2. **Nictiz fallback** — if local validation fails, try the Nictiz `CodeSystem/$lookup` endpoint
3. **Local CodeSystem** — validate directly against a locally loaded CodeSystem
4. **Pattern validation** — format checks for known systems (SNOMED, LOINC, BSN elfproef, AGB-Z, UZI, NPI)
5. **Trusted systems** — always accept codes from well-known FHIR systems (administrative-gender, etc.)
6. **Nictiz CodeSystem** — for completely unknown systems, try Nictiz
7. **Skip** — if nothing can validate the code, accept it with a message

## Directory Layout

```
profiles/r4-core/     -- Base FHIR R4 StructureDefinitions
profiles/nl-core/     -- nl-core profile overlays
terminology/r4-core/  -- Base FHIR R4 ValueSets and CodeSystems
terminology/nl-core/  -- nl-core terminology
```

Directories are loaded in order — base definitions first so that profile overlays can inherit from them.

## Development

```bash
npm run build    # Compile TypeScript to dist/
npm test         # Run tests (30 tests)
npm run dev      # Run via ts-node
npm run lint     # ESLint
```

## License

ISC

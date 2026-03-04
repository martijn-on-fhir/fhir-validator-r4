# FHIR Profielen & Terminologie — Download Instructies

Dit document beschrijft hoe je de benodigde FHIR R4 profielen en terminologie
downloadt voor gebruik met de `fhir-r4-validator`.

---

## Benodigde packages

| Package | Inhoud | Bron |
|---|---|---|
| `hl7.fhir.r4.core` | Basis FHIR R4 profielen (Patient, Practitioner, etc.) | HL7 / Simplifier |
| `nictiz.fhir.nl.r4.nl-core` | Nederlandse nl-core R4 profielen | Nictiz / Simplifier |
| `nictiz.fhir.nl.r4.zib2020` | Zorginformatiebouwstenen (ZIB) 2020 | Nictiz / Simplifier |

---

## Doelstructuur

Na het downloaden moet je projectmap er zo uitzien:

```
fhir-validator/
├── profiles/
│   ├── r4-core/                         ← hl7.fhir.r4.core
│   │   ├── StructureDefinition-Patient.json
│   │   ├── StructureDefinition-Practitioner.json
│   │   ├── StructureDefinition-Organization.json
│   │   ├── StructureDefinition-Observation.json
│   │   └── ...                          (700+ bestanden)
│   └── nl-core/                         ← nictiz.fhir.nl.r4.nl-core
│       ├── StructureDefinition-nl-core-Patient.json
│       ├── StructureDefinition-nl-core-Practitioner.json
│       ├── StructureDefinition-nl-core-Organization.json
│       └── ...
├── terminology/
│   ├── r4-core/                         ← ValueSets en CodeSystems uit hl7.fhir.r4.core
│   │   ├── ValueSet-administrative-gender.json
│   │   ├── ValueSet-observation-status.json
│   │   └── ...
│   └── nl-core/                         ← Nederlandse terminologie
│       ├── ValueSet-NL-CM-*.json
│       └── CodeSystem-*.json
├── src/
├── tests/
└── package.json
```

---

## ⚠️ Let op: niet via npmjs.com

`hl7.fhir.r4.core` op **npmjs.com is een security holding package** en bevat
geen FHIR bestanden. Gebruik altijd de Simplifier registry of de directe download
hieronder.

---

## Optie A — Directe download via Simplifier (aanbevolen)

De Simplifier package registry heeft een directe download URL per package.
Je kunt deze URL gewoon in je browser openen — het bestand wordt direct aangeboden.

### hl7.fhir.r4.core

```bash
mkdir -p profiles/r4-core terminology/r4-core

# Download direct (browser of curl)
curl -L https://packages.simplifier.net/hl7.fhir.r4.core/4.0.1 \
     -o hl7.fhir.r4.core-4.0.1.tgz

tar -xzf hl7.fhir.r4.core-4.0.1.tgz

cp package/StructureDefinition-*.json profiles/r4-core/
cp package/ValueSet-*.json            terminology/r4-core/
cp package/CodeSystem-*.json          terminology/r4-core/

rm -rf package hl7.fhir.r4.core-4.0.1.tgz
```

### nictiz.fhir.nl.r4.nl-core

Ga eerst naar [simplifier.net/packages/nictiz.fhir.nl.r4.nl-core](https://simplifier.net/packages/nictiz.fhir.nl.r4.nl-core)
om de laatste versie op te zoeken, en vervang `<versie>` hieronder:

```bash
mkdir -p profiles/nl-core terminology/nl-core

curl -L https://packages.simplifier.net/nictiz.fhir.nl.r4.nl-core/<versie> \
     -o nl-core.tgz

tar -xzf nl-core.tgz

cp package/StructureDefinition-*.json profiles/nl-core/
cp package/ValueSet-*.json            terminology/nl-core/
cp package/CodeSystem-*.json          terminology/nl-core/

rm -rf package nl-core.tgz
```

### nictiz.fhir.nl.r4.zib2020 (optioneel)

```bash
curl -L https://packages.simplifier.net/nictiz.fhir.nl.r4.zib2020/<versie> \
     -o zib2020.tgz

tar -xzf zib2020.tgz
cp package/StructureDefinition-*.json profiles/nl-core/
rm -rf package zib2020.tgz
```

---

## Optie B — Via npm met Simplifier registry

De Simplifier registry werkt als een NPM-compatible registry. Gebruik de
`--registry` vlag om de juiste bron te selecteren:

```bash
# Eenmalig instellen voor dit project
npm config set @hl7:registry https://packages.simplifier.net

# Of direct meegeven per commando
npm --registry https://packages.simplifier.net install hl7.fhir.r4.core@4.0.1

# nl-core
npm --registry https://packages.simplifier.net install nictiz.fhir.nl.r4.nl-core
```

De bestanden landen dan in `node_modules/`:

```bash
mkdir -p profiles/r4-core profiles/nl-core terminology/r4-core terminology/nl-core

cp node_modules/hl7.fhir.r4.core/package/StructureDefinition-*.json profiles/r4-core/
cp node_modules/hl7.fhir.r4.core/package/ValueSet-*.json            terminology/r4-core/
cp node_modules/hl7.fhir.r4.core/package/CodeSystem-*.json          terminology/r4-core/

cp node_modules/nictiz.fhir.nl.r4.nl-core/package/StructureDefinition-*.json profiles/nl-core/
cp node_modules/nictiz.fhir.nl.r4.nl-core/package/ValueSet-*.json            terminology/nl-core/
cp node_modules/nictiz.fhir.nl.r4.nl-core/package/CodeSystem-*.json          terminology/nl-core/
```

---

## Optie C — Via FHIR Package CLI

```bash
# Installeer de FHIR package loader
npm install -g fhir-package-loader

# Download packages naar huidige map
fpl install hl7.fhir.r4.core@4.0.1 --here
fpl install nictiz.fhir.nl.r4.nl-core --here

# Kopieer naar projectmap
mkdir -p profiles/r4-core profiles/nl-core terminology/r4-core terminology/nl-core

cp hl7.fhir.r4.core/package/StructureDefinition-*.json profiles/r4-core/
cp hl7.fhir.r4.core/package/ValueSet-*.json            terminology/r4-core/
cp hl7.fhir.r4.core/package/CodeSystem-*.json          terminology/r4-core/

cp nictiz.fhir.nl.r4.nl-core/package/StructureDefinition-*.json profiles/nl-core/
cp nictiz.fhir.nl.r4.nl-core/package/ValueSet-*.json            terminology/nl-core/
cp nictiz.fhir.nl.r4.nl-core/package/CodeSystem-*.json          terminology/nl-core/
```

---

## Validator configuratie

Laad de profielen in de juiste volgorde — **basis eerst, nl-core daarna**:

```typescript
const validator = await FhirValidator.create({
  profilesDir: './profiles/r4-core',
  terminologyDir: './terminology/r4-core',
});

// nl-core bovenop laden (overschrijft waar nodig)
await validator.registry.loadFromDirectory('./profiles/nl-core');
await validator.terminology.loadFromDirectory('./terminology/nl-core');
```

> **Let op:** De volgorde is belangrijk. De `StructureDefinitionRegistry` resolvet
> `baseDefinition` chains — nl-core profielen erven van R4 core, dus R4 core
> moet eerst geladen zijn.

---

## Verificatie

Controleer na het laden of de profielen correct zijn ingeladen:

```typescript
console.log(validator.stats());
// {
//   profiles: 748,       ← r4-core (~700) + nl-core (~48)
//   valueSets: 895,
//   codeSystems: 201,
//   terminologyCacheLookups: 0
// }

// Controleer een specifiek profiel
const sd = validator.registry.resolve(
  'http://fhir.nl/fhir/StructureDefinition/nl-core-Patient'
);
console.log(sd?.name); // "nl-core-Patient"
```

---

## Nuttige links

- [Simplifier.net packages](https://simplifier.net/packages)
- [HL7 FHIR R4 downloads](https://hl7.org/fhir/R4/downloads.html)
- [Nictiz GitHub](https://github.com/Nictiz/Nictiz-R4-zib2020)
- [FHIR Package Registry](https://packages.fhir.org)

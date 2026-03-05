/**
 * fhir-validator-mx — Usage Demo
 *
 * Run with: npx ts-node samples/demo.ts
 */
import * as path from 'path';
import { FhirValidator } from '../src';

// ─── Helper ──────────────────────────────────────────────
function printResult(label: string, result: { valid: boolean; issues: Array<{ severity: string; path: string; message: string }> }) {
  console.log(`\n=== ${label} ===`);
  console.log(`Valid: ${result.valid}`);
  if (result.issues.length === 0) {
    console.log('  No issues.');
  }
  for (const issue of result.issues) {
    console.log(`  [${issue.severity}] ${issue.path || '(root)'}: ${issue.message}`);
  }
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  const root = path.resolve(__dirname, '..');

  // ── 1. Create validator with profile & terminology directories ──
  console.log('Loading profiles and terminology...');
  const validator = await FhirValidator.create({
    profilesDirs: [
      path.join(root, 'profiles', 'r4-core'),
      path.join(root, 'profiles', 'nl-core'),
    ],
    terminologyDirs: [
      path.join(root, 'terminology', 'r4-core'),
      path.join(root, 'terminology', 'nl-core'),
    ],
  });

  const stats = validator.stats();
  console.log(`Loaded ${stats.profiles} profiles, ${stats.valueSets} ValueSets, ${stats.codeSystems} CodeSystems`);

  // ── 2. Validate a valid Patient ─────────────────────────────────
  const validPatient = {
    resourceType: 'Patient',
    id: 'example-mx-patient',
    identifier: [{
      system: 'urn:oid:2.16.840.1.113883.4.629',
      value: 'CURP123456ABCDEF01',
    }],
    name: [{
      family: 'Garcia Lopez',
      given: ['Maria', 'Elena'],
    }],
    gender: 'female',
    birthDate: '1990-05-15',
  };

  const result1 = await validator.validate(validPatient);
  printResult('Valid Patient', result1);

  // ── 3. Validate a Patient with missing required fields ──────────
  const incompletePatient = {
    resourceType: 'Patient',
    // no identifier, no name
    gender: 'male',
  };

  const result2 = await validator.validate(incompletePatient);
  printResult('Incomplete Patient (no identifier/name)', result2);

  // ── 4. Validate a resource with invalid structure ───────────────
  const result3 = await validator.validate(null);
  printResult('Null resource', result3);

  const result4 = await validator.validate({ id: 'no-type' });
  printResult('Missing resourceType', result4);

  // ── 5. Programmatic profile registration ────────────────────────
  console.log('\n=== Programmatic Profile Demo ===');

  const customProfile = {
    resourceType: 'StructureDefinition',
    url: 'http://example.org/fhir/StructureDefinition/mx-Observation',
    name: 'mx-Observation',
    status: 'active',
    kind: 'resource' as const,
    abstract: false,
    type: 'Observation',
    baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Observation',
    snapshot: {
      element: [
        { id: 'Observation', path: 'Observation', min: 0, max: '*' },
        { id: 'Observation.status', path: 'Observation.status', min: 1, max: '1', type: [{ code: 'code' }] },
        { id: 'Observation.code', path: 'Observation.code', min: 1, max: '1', type: [{ code: 'CodeableConcept' }] },
      ],
    },
  };

  validator.registerProfile(customProfile);

  const observation = {
    resourceType: 'Observation',
    status: 'final',
    code: {
      coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }],
    },
    valueQuantity: { value: 120, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
  };

  const result5 = await validator.validate(observation, 'http://example.org/fhir/StructureDefinition/mx-Observation');
  printResult('Custom Observation profile', result5);

  // ── 6. Batch validation ─────────────────────────────────────────
  console.log('\n=== Batch Validation ===');
  const batch = [validPatient, incompletePatient, observation];
  const batchResults = await validator.validateBatch(batch);
  batchResults.forEach((r, i) => {
    console.log(`  Resource ${i + 1} (${(batch[i] as any).resourceType}): ${r.valid ? 'VALID' : 'INVALID'} — ${r.issues.filter(x => x.severity === 'error').length} error(s)`);
  });

  // ── 7. Direct terminology validation ────────────────────────────
  console.log('\n=== Terminology Checks ===');
  const genderCheck = await validator.terminology.validateCode(
    'http://hl7.org/fhir/administrative-gender', 'female'
  );
  console.log(`  Gender "female": valid=${genderCheck.valid}`);

  const snomedCheck = await validator.terminology.validateCode(
    'http://snomed.info/sct', '389145006'
  );
  console.log(`  SNOMED "389145006": valid=${snomedCheck.valid}`);

  const badSnomed = await validator.terminology.validateCode(
    'http://snomed.info/sct', 'abc'
  );
  console.log(`  SNOMED "abc": valid=${badSnomed.valid} — ${badSnomed.message}`);
}

main().catch(console.error);

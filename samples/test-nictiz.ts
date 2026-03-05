import * as path from 'path';
import { FhirValidator, TerminologyService } from '../src';
import type { NictizTerminologyConfig } from '../src';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const config = await FhirValidator.loadConfig(path.join(root, 'config.local.json'));

  if (!config?.terminology) {
    console.log('No config.local.json found — skipping Nictiz test');

    return;
  }

  console.log('Testing Nictiz terminologieserver connection...\n');

  const terminology = new TerminologyService({
    nictiz: config.terminology as NictizTerminologyConfig,
  });

  // Test 1: Validate a SNOMED code via Nictiz
  console.log('1. SNOMED code 47078008 (gehoorfunctie):');
  const r1 = await terminology.validateCode(
    'http://snomed.info/sct', '47078008',
    'http://snomed.info/sct?fhir_vs'
  );
  console.log('  ', r1);

  // Test 2: Validate an invalid SNOMED code
  console.log('\n2. SNOMED code 9999999 (does not exist):');
  const r2 = await terminology.validateCode(
    'http://snomed.info/sct', '9999999',
    'http://snomed.info/sct?fhir_vs'
  );
  console.log('  ', r2);

  // Test 3: Validate a LOINC code
  console.log('\n3. LOINC code 85354-9 (blood pressure panel):');
  const r3 = await terminology.validateCode(
    'http://loinc.org', '85354-9',
    'http://loinc.org/vs'
  );
  console.log('  ', r3);
}

main();

import * as path from 'path';
import { FhirValidator, NictizTerminologyClient } from '../src';
import type { NictizTerminologyConfig } from '../src';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const config = await FhirValidator.loadConfig(path.join(root, 'config.local.json'));

  if (!config?.terminology) {
    console.log('No config.local.json found — skipping Nictiz test');

    return;
  }

  console.log('Testing Nictiz terminologieserver connection...\n');
  const nictiz = new NictizTerminologyClient(config.terminology as NictizTerminologyConfig);

  // Test 1: Validate a valid SNOMED code via CodeSystem
  console.log('1. SNOMED 47078008 (gehoorfunctie):');
  const r1 = await nictiz.validateCode('http://snomed.info/sct', '47078008');
  console.log('  ', r1);

  // Test 2: Validate an invalid SNOMED code
  console.log('\n2. SNOMED 9999999 (does not exist):');
  const r2 = await nictiz.validateCode('http://snomed.info/sct', '9999999');
  console.log('  ', r2);

  // Test 3: Validate a LOINC code via CodeSystem
  console.log('\n3. LOINC 85354-9 (blood pressure panel):');
  const r3 = await nictiz.validateCode('http://loinc.org', '85354-9');
  console.log('  ', r3);
}

main();

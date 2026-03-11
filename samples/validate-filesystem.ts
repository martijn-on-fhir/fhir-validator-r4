/**
 * Validate all FHIR resources in samples/data using filesystem-based profile/terminology loading.
 *
 * Usage: npx ts-node samples/validate-filesystem.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
// @ts-ignore
import { FhirValidator } from '../dist/index.mjs';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');

const main = async () => {
  const validator = await FhirValidator.create({
    profilesDirs: ['profiles/r4-core', 'profiles/nl-core'],
    terminologyDirs: ['terminology/r4-core', 'terminology/nl-core'],
    terminology: { disableExternalCalls: true },
  });

  await validator.preload();

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  let passed = 0;
  let failed = 0;

  console.log(`Validating ${files.length} resources from filesystem...\n`);

  for (const file of files) {
    const resource = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
    const result = await validator.validate(resource);

    if (result.valid) {
      passed++;
    } else {
      failed++;
      console.log(`FAIL  ${file}`);

      for (const issue of result.issues.filter((i: any) => i.severity === 'error')) {
        console.log(`      ${issue.path}: ${issue.message}`);
      }
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${files.length} total`);
  process.exit(failed > 0 ? 1 : 0);
};

main().catch(err => { console.error(err); process.exit(1); });
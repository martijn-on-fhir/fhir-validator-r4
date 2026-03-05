import * as path from 'path';
import * as fs from 'node:fs';
import { FhirValidator } from '../src';

async function main(): Promise<void> {

  const root = path.resolve(__dirname, '..');

  // ── Load optional credentials from config.local.json ──
  const config = await FhirValidator.loadConfig(path.join(root, 'config.local.json'));
  const nictizConfig = config?.terminology;

  if (nictizConfig) {
    console.log('Nictiz terminologieserver configured');
  } else {
    console.log('No config.local.json found, running without Nictiz terminology server');
  }

  // ── Create validator with profile & terminology directories ──
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
    terminology: {
      nictiz: nictizConfig,
    },
  });

  console.log('Stats:', validator.stats());

  const raw = fs.readFileSync(path.join(root, 'samples', 'data', 'nl-core-Patient-01.json'), 'utf8');
  const resource = JSON.parse(raw);

  const result = await validator.validate(resource);

  console.log(`Valid: ${result.valid} (${result.issues.length} issues)`);
  console.log(`Validation ID: ${result.validationId}`);

  for (const issue of result.issues) {
    console.log(`  [${issue.severity}] ${issue.path}: ${issue.message}`);
  }
}

main();

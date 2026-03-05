import * as path from 'path';
import { FhirValidator } from '../src';
import * as fs from 'node:fs'

async function main(): Promise<void> {

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

  const raw = fs.readFileSync(path.join(root, 'samples', 'data', 'nl-core-HearingFunction-01.json'), 'utf8');
  const validPatient = JSON.parse(raw);

  const result = await validator.validate(validPatient);

  console.dir(result.issues)
}

main()
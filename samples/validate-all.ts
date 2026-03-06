import * as path from 'path';
import * as fs from 'node:fs';
import { FhirValidator } from '../dist';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'samples', 'data');
  const failuresDir = path.join(root, 'samples', 'failures');

  // Ensure failures directory exists
  if (!fs.existsSync(failuresDir)) {
    fs.mkdirSync(failuresDir, { recursive: true });
  }

  // Load config & create validator
  const config = await FhirValidator.loadConfig(path.join(root, 'config.local.json'));
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
    terminology: { nictiz: config?.terminology },
  });

  // Collect all JSON files
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json')).sort();
  const total = files.length;
  let passed = 0;
  let failed = 0;
  let errors = 0;

  console.log(`\nValidating ${total} files...\n`);

  const startTime = performance.now();

  for (let i = 0; i < files.length; i++) {

    const file = files[i];
    const filePath = path.join(dataDir, file);
    const progress = `${String(i + 1).padStart(String(total).length, ' ')}/${total}\t`;

    try {
      const resource = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const result = await validator.validate(resource);

      if (result.valid) {
        console.log(`${progress} PASS  ${file}`);
        passed++;
      } else {
        console.log(`${progress} FAIL  ${file}`);
        for (const issue of result.issues.filter(i => i.severity === 'error')) {
          console.log(`         [${issue.severity}] ${issue.path}: ${issue.message}`);
        }
        fs.copyFileSync(filePath, path.join(failuresDir, file));
        failed++;
      }
    } catch (err) {
      console.log(`${progress} ERROR ${file}: ${(err as Error).message}`);
      fs.copyFileSync(filePath, path.join(failuresDir, file));
      errors++;
    }
  }

  const elapsed = performance.now() - startTime;
  const avg = elapsed / total;

  console.log(`\n${'- '.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${errors} errors (${total} total)`);
  console.log(`Time: ${(elapsed / 1000).toFixed(2)}s total, ${avg.toFixed(1)}ms avg per resource`);
  console.log(`${'- '.repeat(40)}`);

  if (failed + errors > 0) {
    console.log(`Failed files copied to: samples/failures/`);
  }
}

main();

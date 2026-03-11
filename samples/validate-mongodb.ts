/**
 * Validate all FHIR resources in samples/data using MongoDB-based profile/terminology loading.
 *
 * Prerequisites:
 *   - MongoDB running locally with conformance resources in fhir.conformance_resources
 *   - npm install mongodb  (in this project or globally)
 *
 * Usage: npx ts-node samples/validate-mongodb.ts [mongodb://localhost:27017]
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
// @ts-ignore
import { FhirValidator, MongoSource } from '../dist/index.mjs';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const MONGO_URL = process.argv[2] || 'mongodb://localhost:27017';
const DB_NAME = 'fhir';
const COLLECTION_NAME = 'conformance_resources';

const main = async () => {
  const client = new MongoClient(MONGO_URL);

  try {
    await client.connect();
    console.log(`Connected to MongoDB at ${MONGO_URL}`);

    const collection = client.db(DB_NAME).collection(COLLECTION_NAME);
    const count = await collection.countDocuments({ resourceType: { $in: ['StructureDefinition', 'ValueSet', 'CodeSystem'] } });
    console.log(`Found ${count} conformance resources in ${DB_NAME}.${COLLECTION_NAME}\n`);

    const validator = await FhirValidator.create({
      sources: [new MongoSource(collection)],
      terminology: { disableExternalCalls: true },
    });

    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    let passed = 0;
    let failed = 0;

    console.log(`Validating ${files.length} resources from MongoDB...\n`);

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
  } finally {
    await client.close();
  }
};

main().catch(err => { console.error(err); process.exit(1); });
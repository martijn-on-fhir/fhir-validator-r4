const path = require('path');
const { StructureDefinitionRegistry } = require('../src');

async function main() {
  const root = path.resolve(__dirname, '..');
  const registry = new StructureDefinitionRegistry();
  await registry.loadFromDirectory(path.join(root, 'profiles', 'r4-core'));
  await registry.loadFromDirectory(path.join(root, 'profiles', 'nl-core'));

  const sd = registry.resolve('http://nictiz.nl/fhir/StructureDefinition/nl-core-HearingFunction');
  const resolved = registry.resolveElements(sd);

  console.log('All required elements (min > 0) in nl-core-HearingFunction:');
  for (const e of resolved) {
    if (e.min > 0) {
      console.log(`  ${e.path} (min: ${e.min}, max: ${e.max})`);
    }
  }
}

main().catch(console.error);

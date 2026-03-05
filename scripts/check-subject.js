const path = require('path');
const { FhirValidator } = require('../src');

async function main() {
  const root = path.resolve(__dirname, '..');
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

  const resource = {
    resourceType: "Observation",
    id: "nl-core-HearingFunction-01",
    meta: {
      profile: ["http://nictiz.nl/fhir/StructureDefinition/nl-core-HearingFunction"]
    },
    status: "final",
    code: {
      coding: [{ system: "http://snomed.info/sct", code: "47078008", display: "gehoorfunctie" }]
    },
    valueCodeableConcept: {
      coding: [{ system: "http://snomed.info/sct", code: "15188001", display: "Gehoorverlies" }]
    }
  };

  const result = await validator.validate(resource);
  console.log('Valid:', result.valid);
  console.log('Issues:', result.issues.length);
  for (const issue of result.issues) {
    console.log(`  [${issue.severity}] ${issue.path}: ${issue.message}`);
  }
}

main().catch(console.error);

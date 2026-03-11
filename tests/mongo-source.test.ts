import { FhirValidator, MongoSource, type MongoCollection } from '../src';

/** Creates a mock MongoDB collection from an array of documents */
const mockCollection = (docs: Record<string, unknown>[]): MongoCollection => ({
  find: () => ({ toArray: async () => docs.map(d => ({...d})) }),
});

describe('MongoSource', () => {

  it('loads StructureDefinitions from MongoDB', async () => {
    const collection = mockCollection([
      {
        _id: 'abc123',
        resourceType: 'StructureDefinition',
        url: 'http://example.org/fhir/StructureDefinition/TestPatient',
        name: 'TestPatient',
        type: 'Patient',
        status: 'active',
        kind: 'resource',
        abstract: false,
        baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
        snapshot: {
          element: [
            { id: 'Patient', path: 'Patient', min: 0, max: '*' },
            { id: 'Patient.resourceType', path: 'Patient.resourceType', min: 1, max: '1' },
          ],
        },
      },
    ]);

    const validator = await FhirValidator.create({
      sources: [new MongoSource(collection)],
    });

    const sd = validator.registry.resolve('http://example.org/fhir/StructureDefinition/TestPatient');
    expect(sd).toBeDefined();
    expect(sd?.name).toBe('TestPatient');
  });

  it('loads ValueSets and CodeSystems from MongoDB', async () => {
    const collection = mockCollection([
      {
        _id: 'vs1',
        resourceType: 'ValueSet',
        url: 'http://example.org/fhir/ValueSet/test-vs',
        status: 'active',
        compose: {
          include: [{ system: 'http://example.org/fhir/CodeSystem/test-cs' }],
        },
      },
      {
        _id: 'cs1',
        resourceType: 'CodeSystem',
        url: 'http://example.org/fhir/CodeSystem/test-cs',
        status: 'active',
        content: 'complete',
        concept: [
          { code: 'A', display: 'Alpha' },
          { code: 'B', display: 'Beta' },
        ],
      },
    ]);

    const validator = await FhirValidator.create({
      sources: [new MongoSource(collection)],
      terminology: { disableExternalCalls: true },
    });

    const result = await validator.terminology.validateCode(
      'http://example.org/fhir/CodeSystem/test-cs', 'A',
      'http://example.org/fhir/ValueSet/test-vs'
    );
    expect(result.valid).toBe(true);
    expect(result.display).toBe('Alpha');

    const invalid = await validator.terminology.validateCode(
      'http://example.org/fhir/CodeSystem/test-cs', 'Z',
      'http://example.org/fhir/ValueSet/test-vs'
    );
    expect(invalid.valid).toBe(false);
  });

  it('strips _id field from MongoDB documents', async () => {
    const source = new MongoSource(mockCollection([
      { _id: 'should-be-removed', resourceType: 'StructureDefinition', url: 'http://example.org/sd1', name: 'SD1', type: 'Patient', status: 'active', kind: 'resource', abstract: false },
    ]));

    const resources = await source.loadAll();
    expect(resources[0]._id).toBeUndefined();
  });

  it('applies custom filter to MongoDB query', async () => {
    let capturedFilter: Record<string, unknown> = {};
    const collection: MongoCollection = {
      find: (filter) => {
        capturedFilter = filter ?? {};
        return { toArray: async () => [] };
      },
    };

    const source = new MongoSource(collection, { status: 'active' });
    await source.loadAll();

    expect(capturedFilter).toEqual({
      resourceType: { $in: ['StructureDefinition', 'ValueSet', 'CodeSystem'] },
      status: 'active',
    });
  });

  it('persists externally resolved resources via save()', async () => {
    const saved: Record<string, unknown>[] = [];
    const collection: MongoCollection = {
      find: () => ({ toArray: async () => [] }),
      replaceOne: async (_filter, doc) => { saved.push(doc); },
    };

    const source = new MongoSource(collection);

    // Manually trigger onExternalResolve (simulates what happens when Art-Decor resolves a VS)
    const validator = await FhirValidator.create({
      sources: [source],
      terminology: { disableExternalCalls: true },
    });

    // Simulate external resolve callback
    validator.terminology.onExternalResolve!({
      resourceType: 'ValueSet',
      url: 'http://example.org/fhir/ValueSet/resolved-vs',
      status: 'active',
    });

    // Give the async save a tick to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(saved).toHaveLength(1);
    expect(saved[0].url).toBe('http://example.org/fhir/ValueSet/resolved-vs');
  });

  it('works alongside filesystem directories', async () => {
    const collection = mockCollection([
      {
        resourceType: 'CodeSystem',
        url: 'http://example.org/fhir/CodeSystem/mongo-cs',
        status: 'active',
        content: 'complete',
        concept: [{ code: 'X', display: 'X-ray' }],
      },
    ]);

    const validator = await FhirValidator.create({
      profilesDirs: ['profiles/r4-core'],
      terminologyDirs: ['terminology/r4-core'],
      sources: [new MongoSource(collection)],
      terminology: { disableExternalCalls: true },
    });

    // MongoDB resource should be available
    const result = await validator.terminology.validateCode('http://example.org/fhir/CodeSystem/mongo-cs', 'X');
    expect(result.valid).toBe(true);

    // Filesystem resources should still work
    const patientSd = validator.registry.resolve('http://hl7.org/fhir/StructureDefinition/Patient');
    expect(patientSd).toBeDefined();
  });
});
// tests/validator.test.ts
import { FhirValidator } from '../src';

// Minimal Patient profile for testing
const PATIENT_PROFILE = {
  resourceType: 'StructureDefinition',
  url: 'http://example.org/fhir/StructureDefinition/mx-Patient',
  name: 'mx-Patient',
  status: 'active',
  kind: 'resource',
  abstract: false,
  type: 'Patient',
  baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
  snapshot: {
    element: [
      {
        id: 'Patient',
        path: 'Patient',
        min: 0,
        max: '*'
      },
      {
        id: 'Patient.identifier',
        path: 'Patient.identifier',
        min: 1,  // Require at least 1 identifier (e.g. CURP)
        max: '*',
        type: [{ code: 'Identifier' }]
      },
      {
        id: 'Patient.name',
        path: 'Patient.name',
        min: 1,
        max: '*',
        type: [{ code: 'HumanName' }]
      },
      {
        id: 'Patient.birthDate',
        path: 'Patient.birthDate',
        min: 0,
        max: '1',
        type: [{ code: 'date' }]
      },
      {
        id: 'Patient.gender',
        path: 'Patient.gender',
        min: 0,
        max: '1',
        type: [{ code: 'code' }],
        binding: {
          strength: 'required',
          valueSet: 'http://hl7.org/fhir/ValueSet/administrative-gender'
        }
      }
    ]
  }
};

// Minimal ValueSet for gender
const GENDER_VALUESET = {
  resourceType: 'ValueSet',
  url: 'http://hl7.org/fhir/ValueSet/administrative-gender',
  name: 'AdministrativeGender',
  status: 'active',
  compose: {
    include: [{
      system: 'http://hl7.org/fhir/administrative-gender',
      concept: [
        { code: 'male',    display: 'Male' },
        { code: 'female',  display: 'Female' },
        { code: 'other',   display: 'Other' },
        { code: 'unknown', display: 'Unknown' }
      ]
    }]
  }
};

let validator: FhirValidator;

beforeAll(async () => {
  validator = await FhirValidator.create();

  // Register test profile and terminology
  validator.registerProfile(PATIENT_PROFILE);
  validator.terminology.registerValueSet(GENDER_VALUESET as any);
});

describe('Basic structure validation', () => {
  it('returns error for null resource', async () => {
    const result = await validator.validate(null);
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('null');
  });

  it('returns error for missing resourceType', async () => {
    const result = await validator.validate({ id: '123' });
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toBe('resourceType');
  });
});

describe('mx-Patient validation', () => {
  const PROFILE = 'http://example.org/fhir/StructureDefinition/mx-Patient';

  it('validates a valid patient', async () => {
    const patient = {
      resourceType: 'Patient',
      id: 'test-patient',
      identifier: [{
        system: 'urn:oid:2.16.840.1.113883.4.629',
        value: 'CURP123456ABCDEF01'
      }],
      name: [{
        family: 'Garcia',
        given: ['Maria']
      }],
      gender: 'female',
      birthDate: '1985-03-12'
    };

    const result = await validator.validate(patient, PROFILE);
    expect(result.valid).toBe(true);
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('returns error for missing identifier (min: 1)', async () => {
    const patient = {
      resourceType: 'Patient',
      name: [{ family: 'Test' }]
    };

    const result = await validator.validate(patient, PROFILE);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i =>
      i.path === 'identifier' && i.severity === 'error'
    )).toBe(true);
  });

  it('returns error for missing name (min: 1)', async () => {
    const patient = {
      resourceType: 'Patient',
      identifier: [{ system: 'urn:oid:2.16.840.1.113883.4.629', value: 'CURP123456ABCDEF01' }]
    };

    const result = await validator.validate(patient, PROFILE);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i =>
      i.path === 'name' && i.severity === 'error'
    )).toBe(true);
  });

  it('returns error for invalid gender code', async () => {
    const patient = {
      resourceType: 'Patient',
      identifier: [{ system: 'urn:oid:2.16.840.1.113883.4.629', value: 'CURP123456ABCDEF01' }],
      name: [{ family: 'Test' }],
      gender: 'INVALID_GENDER'  // Not in ValueSet
    };

    const result = await validator.validate(patient, PROFILE);
    expect(result.issues.some(i =>
      i.path === 'gender' && i.severity === 'error'
    )).toBe(true);
  });

  it('validates batch of resources', async () => {
    const resources = [
      {
        resourceType: 'Patient',
        identifier: [{ system: 'urn:oid:2.16.840.1.113883.4.629', value: 'CURP111222ABCDEF01' }],
        name: [{ family: 'Lopez' }]
      },
      {
        resourceType: 'Patient',
        // Missing identifier and name -> invalid
      }
    ];

    const results = await Promise.all(
      resources.map(r => validator.validate(r, PROFILE))
    );
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
  });
});

describe('Terminology validation', () => {
  it('accepts valid gender code', async () => {
    const result = await validator.terminology.validateCode(
      'http://hl7.org/fhir/administrative-gender',
      'female',
      'http://hl7.org/fhir/ValueSet/administrative-gender'
    );
    expect(result.valid).toBe(true);
  });

  it('rejects invalid gender code', async () => {
    const result = await validator.terminology.validateCode(
      'http://hl7.org/fhir/administrative-gender',
      'man',
      'http://hl7.org/fhir/ValueSet/administrative-gender'
    );
    expect(result.valid).toBe(false);
  });

  it('validates BSN pattern', async () => {
    const valid = await validator.terminology.validateCode(
      'http://fhir.nl/fhir/NamingSystem/bsn', '123456789'
    );
    const invalid = await validator.terminology.validateCode(
      'http://fhir.nl/fhir/NamingSystem/bsn', 'abc'
    );
    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
  });
});

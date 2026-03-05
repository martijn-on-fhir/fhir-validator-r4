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

// -------------------------------------------------------
// Basic structure validation
// -------------------------------------------------------

describe('Basic structure validation', () => {
  it('returns error for null resource', async () => {
    const result = await validator.validate(null);
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('null');
  });

  it('returns error for undefined resource', async () => {
    const result = await validator.validate(undefined);
    expect(result.valid).toBe(false);
  });

  it('returns error for array resource', async () => {
    const result = await validator.validate([]);
    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('JSON object');
  });

  it('returns error for primitive resource', async () => {
    const result = await validator.validate('not an object');
    expect(result.valid).toBe(false);
  });

  it('returns error for missing resourceType', async () => {
    const result = await validator.validate({ id: '123' });
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toBe('resourceType');
  });

  it('returns error for non-string resourceType', async () => {
    const result = await validator.validate({ resourceType: 123 });
    expect(result.valid).toBe(false);
    expect(result.issues[0].path).toBe('resourceType');
  });
});

// -------------------------------------------------------
// Validation metadata
// -------------------------------------------------------

describe('Validation metadata', () => {
  it('includes validationId and timestamp', async () => {
    const result = await validator.validate({ resourceType: 'Patient' });
    expect(result.validationId).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('generates unique validationIds per call', async () => {
    const r1 = await validator.validate({ resourceType: 'Patient' });
    const r2 = await validator.validate({ resourceType: 'Patient' });
    expect(r1.validationId).not.toBe(r2.validationId);
  });
});

// -------------------------------------------------------
// Prototype pollution detection
// -------------------------------------------------------

describe('Prototype pollution detection', () => {
  it('detects __proto__ key in resource', async () => {
    const resource = JSON.parse('{"resourceType":"Patient","__proto__":{"admin":true}}');
    const result = await validator.validate(resource);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'SECURITY')).toBe(true);
  });

  it('detects constructor key in nested object', async () => {
    const resource = {
      resourceType: 'Patient',
      name: [{ constructor: 'evil' }]
    };
    const result = await validator.validate(resource);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'SECURITY')).toBe(true);
  });

  it('allows normal resources without proto keys', async () => {
    const resource = {
      resourceType: 'Patient',
      id: 'safe',
      identifier: [{ system: 'urn:test', value: '123' }],
      name: [{ family: 'Test' }]
    };
    const result = await validator.validate(resource, 'http://example.org/fhir/StructureDefinition/mx-Patient');
    expect(result.issues.filter(i => i.code === 'SECURITY')).toHaveLength(0);
  });
});

// -------------------------------------------------------
// mx-Patient validation
// -------------------------------------------------------

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

// -------------------------------------------------------
// Date/time format validation
// -------------------------------------------------------

describe('Date/time format validation', () => {
  const PROFILE = 'http://example.org/fhir/StructureDefinition/mx-Patient';

  it('accepts valid FHIR date formats', async () => {
    for (const date of ['1985-03-12', '1985-03', '1985']) {
      const patient = {
        resourceType: 'Patient',
        identifier: [{ system: 'urn:test', value: '1' }],
        name: [{ family: 'Test' }],
        birthDate: date
      };

      const result = await validator.validate(patient, PROFILE);
      const dateErrors = result.issues.filter(i => i.path === 'birthDate' && i.code === 'TYPE_MISMATCH');
      expect(dateErrors).toHaveLength(0);
    }
  });

  it('rejects invalid date formats', async () => {
    for (const date of ['03-12-1985', '1985/03/12', 'not-a-date', '']) {
      const patient = {
        resourceType: 'Patient',
        identifier: [{ system: 'urn:test', value: '1' }],
        name: [{ family: 'Test' }],
        birthDate: date
      };

      const result = await validator.validate(patient, PROFILE);
      const dateIssues = result.issues.filter(i => i.path === 'birthDate' && i.code === 'TYPE_MISMATCH');
      expect(dateIssues.length).toBeGreaterThan(0);
    }
  });
});

// -------------------------------------------------------
// Terminology validation
// -------------------------------------------------------

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

  it('validates BSN with elfproef — valid BSN', async () => {
    // 123456782 is a valid BSN (passes 11-test)
    const result = await validator.terminology.validateCode(
      'http://fhir.nl/fhir/NamingSystem/bsn', '123456782'
    );
    expect(result.valid).toBe(true);
  });

  it('validates BSN with elfproef — invalid BSN (wrong check digit)', async () => {
    // 123456789 has correct format but fails 11-test
    const result = await validator.terminology.validateCode(
      'http://fhir.nl/fhir/NamingSystem/bsn', '123456789'
    );
    expect(result.valid).toBe(false);
  });

  it('validates BSN with elfproef — invalid format', async () => {
    const result = await validator.terminology.validateCode(
      'http://fhir.nl/fhir/NamingSystem/bsn', 'abc'
    );
    expect(result.valid).toBe(false);
  });

  it('validates BSN with elfproef — rejects all zeros', async () => {
    const result = await validator.terminology.validateCode(
      'http://fhir.nl/fhir/NamingSystem/bsn', '000000000'
    );
    expect(result.valid).toBe(false);
  });

  it('dynamically infers system from loaded ValueSet', () => {
    const system = validator.terminology.inferSystemFromValueSet(
      'http://hl7.org/fhir/ValueSet/administrative-gender'
    );
    expect(system).toBe('http://hl7.org/fhir/administrative-gender');
  });
});

// -------------------------------------------------------
// Configurable severity overrides
// -------------------------------------------------------

describe('Severity overrides', () => {
  it('can downgrade CODE_INVALID from error to warning', async () => {
    const v = await FhirValidator.create({
      severityOverrides: { CODE_INVALID: 'warning' }
    });
    v.registerProfile(PATIENT_PROFILE);
    v.terminology.registerValueSet(GENDER_VALUESET as any);

    const patient = {
      resourceType: 'Patient',
      identifier: [{ system: 'urn:test', value: '1' }],
      name: [{ family: 'Test' }],
      gender: 'INVALID_CODE'
    };

    const result = await v.validate(patient, 'http://example.org/fhir/StructureDefinition/mx-Patient');
    const codeIssues = result.issues.filter(i => i.code === 'CODE_INVALID');
    expect(codeIssues.every(i => i.severity === 'warning')).toBe(true);
    // Valid because errors were downgraded to warnings
    expect(result.valid).toBe(true);
  });
});

// -------------------------------------------------------
// FHIR version check
// -------------------------------------------------------

describe('FHIR version check', () => {
  it('accepts resources without version when fhirVersion is set', async () => {
    const v = await FhirValidator.create({ fhirVersion: '4.0.1' });
    v.registerProfile(PATIENT_PROFILE);

    const result = await v.validate({
      resourceType: 'Patient',
      identifier: [{ system: 'urn:test', value: '1' }],
      name: [{ family: 'Test' }]
    }, 'http://example.org/fhir/StructureDefinition/mx-Patient');

    expect(result.issues.filter(i => i.code === 'FHIR_VERSION')).toHaveLength(0);
  });

  it('rejects resources with incompatible FHIR version in profile', async () => {
    const v = await FhirValidator.create({ fhirVersion: '4.0.1' });
    v.registerProfile(PATIENT_PROFILE);

    const result = await v.validate({
      resourceType: 'Patient',
      meta: { profile: ['http://example.org/fhir/StructureDefinition/mx-Patient|5.0.0'] }
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.code === 'FHIR_VERSION')).toBe(true);
  });
});

// -------------------------------------------------------
// Error message sanitization
// -------------------------------------------------------

describe('Error message sanitization', () => {
  it('does not leak actual code values in binding error messages', async () => {
    const patient = {
      resourceType: 'Patient',
      identifier: [{ system: 'urn:test', value: '1' }],
      name: [{ family: 'Test' }],
      gender: 'sensitive-value-123'
    };

    const result = await validator.validate(patient, 'http://example.org/fhir/StructureDefinition/mx-Patient');
    const codeIssues = result.issues.filter(i => i.code === 'CODE_INVALID');

    for (const issue of codeIssues) {
      // The actual value should not appear in the error message
      expect(issue.message).not.toContain('sensitive-value-123');
    }
  });
});

// -------------------------------------------------------
// External terminology options
// -------------------------------------------------------

describe('External terminology options', () => {
  it('respects disableExternalCalls option', async () => {
    const v = await FhirValidator.create({
      terminology: {
        externalTxServer: 'https://tx.fhir.org/r4',
        disableExternalCalls: true
      }
    });

    // Should not attempt external call, should return valid with skip message
    const result = await v.terminology.validateCode(
      'http://example.org/unknown-system',
      'test-code',
      'http://example.org/unknown-valueset'
    );

    expect(result.valid).toBe(true);
    expect(result.message).toContain('not locally loaded');
  });
});

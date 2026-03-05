// src/terminology/terminology-service.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  ValueSet,
  CodeSystem,
  CodeSystemConcept,
  CodeValidationResult,
  BindingStrength
} from '../types/fhir';
import {ArtDecorClient} from './art-decor-client';
import {NictizTerminologyClient, type NictizTerminologyConfig} from './nictiz-terminology-client';

/**
 * BSN elfproef (11-test) — validates Dutch citizen service numbers.
 * A BSN is valid when: (9*d1 + 8*d2 + 7*d3 + ... + 2*d8 - 1*d9) % 11 === 0 and result > 0
 */
const isValidBsn = (code: string): boolean => {
  if (!/^\d{9}$/.test(code)) {
    return false;
  }

  const digits = code.split('').map(Number);
  const sum =
    9 * digits[0] + 8 * digits[1] + 7 * digits[2] +
    6 * digits[3] + 5 * digits[4] + 4 * digits[5] +
    3 * digits[6] + 2 * digits[7] - 1 * digits[8];

  return sum > 0 && sum % 11 === 0;
};

// Known systems validated by pattern or custom function
type PatternValidator = RegExp | ((code: string) => boolean);

const PATTERN_VALIDATORS: Record<string, PatternValidator> = {
  'http://snomed.info/sct': /^\d{6,18}$/,
  'http://loinc.org': /^\d{1,5}-\d$/,
  'http://www.nlm.nih.gov/research/umls/rxnorm': /^\d+$/,
  'http://fhir.nl/fhir/NamingSystem/bsn': isValidBsn,
  'http://fhir.nl/fhir/NamingSystem/agb-z': /^\d{8}$/,
  'http://fhir.nl/fhir/NamingSystem/uzi-nr-systems': /^\d+$/,
  'http://hl7.org/fhir/sid/us-npi': /^\d{10}$/,
  'urn:oid:2.16.528.1.1007.3.1': /^\d{9}$/,   // BIG-register
};

// Well-known OID-to-URL aliases (same CodeSystem, different identifiers)
const SYSTEM_ALIASES: Record<string, string> = {
  'urn:oid:1.0.639.1': 'http://terminology.hl7.org/CodeSystem/iso639-1',
  'urn:oid:2.16.840.1.113883.6.121': 'http://terminology.hl7.org/CodeSystem/iso639-2',
  'urn:ietf:bcp:47': 'urn:ietf:bcp:47',
};

// Systems we always accept as valid (cannot be validated locally)
const TRUSTED_SYSTEMS = new Set([
  'http://terminology.hl7.org/CodeSystem/v3-ActCode',
  'http://terminology.hl7.org/CodeSystem/v2-0131',
  'http://hl7.org/fhir/administrative-gender',
  'http://hl7.org/fhir/name-use',
  'http://hl7.org/fhir/address-use',
  'http://hl7.org/fhir/contact-point-system',
  'http://hl7.org/fhir/contact-point-use',
  'http://hl7.org/fhir/identifier-use',
  'http://hl7.org/fhir/allergy-intolerance-type',
  'http://hl7.org/fhir/observation-status',
  'urn:ietf:bcp:47',                              // BCP 47 language tags
  'http://terminology.hl7.org/CodeSystem/iso639-1', // ISO 639-1 language codes
  'http://terminology.hl7.org/CodeSystem/iso639-2', // ISO 639-2 language codes
]);

export interface TerminologyServiceOptions {
  /** External tx server as fallback, e.g. https://tx.fhir.org/r4 */
  externalTxServer?: string;
  /** Timeout for external calls in ms */
  externalTimeoutMs?: number;
  /** Block all external terminology calls (for strict local-only validation) */
  disableExternalCalls?: boolean;
  /** Max external requests per minute (rate limiting) */
  externalRateLimit?: number;
  /** Nictiz terminologieserver credentials (loaded from config.local.json) */
  nictiz?: NictizTerminologyConfig;
  /** Art-decor FHIR server for automatic ValueSet/CodeSystem resolution */
  artDecor?: {
    /** Base URL (default: https://decor.nictiz.nl/fhir) */
    baseUrl?: string;
    /** Timeout in ms (default: 10000) */
    timeoutMs?: number;
    /** Disable art-decor lookups (default: false) */
    disabled?: boolean;
  };
}

export class TerminologyService {

  private valueSets = new Map<string, ValueSet>();
  private codeSystems = new Map<string, CodeSystem>();
  private options: TerminologyServiceOptions;
  private nictizClient: NictizTerminologyClient | null = null;
  private artDecorClient: ArtDecorClient | null = null;

  // Cache for external lookups
  private externalCache = new Map<string, CodeValidationResult>();
  // Rate limiting state
  private externalCallTimestamps: number[] = [];

  constructor(options: TerminologyServiceOptions = {}) {
    this.options = {
      externalTimeoutMs: 5000,
      externalRateLimit: 30,
      ...options
    };

    if (options.nictiz) {
      this.nictizClient = new NictizTerminologyClient(options.nictiz);
    }

    if (!options.artDecor?.disabled && !options.disableExternalCalls) {
      this.artDecorClient = new ArtDecorClient(
        options.artDecor?.baseUrl,
        options.artDecor?.timeoutMs,
      );
    }
  }

  /**
   * Load all ValueSets and CodeSystems from a directory (recursive)
   */
  async loadFromDirectory(dirPath: string): Promise<void> {

    let entries: import('fs').Dirent[];

    try {
      entries = await fs.readdir(dirPath, {withFileTypes: true});
    } catch {
      return; // Directory does not exist
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await this.loadFromDirectory(fullPath);
        continue;
      }

      if (!entry.name.endsWith('.json')) {
        continue;
      }

      try {
        const content = JSON.parse(await fs.readFile(fullPath, 'utf8'));

        if (content.resourceType === 'ValueSet') {
          this.registerValueSet(content as ValueSet);
        } else if (content.resourceType === 'CodeSystem') {
          this.registerCodeSystem(content as CodeSystem);
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  registerValueSet(vs: ValueSet): void {
    this.valueSets.set(vs.url, vs);
  }

  registerCodeSystem(cs: CodeSystem): void {
    this.codeSystems.set(cs.url, cs);
  }

  /**
   * Validate a code against a binding
   */
  async validateCode(rawSystem: string, code: string, valueSetUrl?: string, bindingStrength: BindingStrength = 'required'): Promise<CodeValidationResult> {

    // Resolve system aliases (e.g. urn:oid:1.0.639.1 → http://terminology.hl7.org/CodeSystem/iso639-1)
    const system = SYSTEM_ALIASES[rawSystem] ?? rawSystem;

    // 1. Validate via ValueSet if specified
    if (valueSetUrl) {
      // Strip version suffix (e.g., "|4.0.1") for lookup
      const vsUrlClean = valueSetUrl.split('|')[0];
      const vs = this.valueSets.get(valueSetUrl) ?? this.valueSets.get(vsUrlClean);

      const resolvedVs = vs ?? await this.resolveValueSetFromArtDecor(vsUrlClean);

      if (resolvedVs) {
        const localResult = this.validateAgainstValueSet(system, code, resolvedVs);

        if (localResult.valid) {
          return localResult;
        }

        // For extensible/preferred bindings, codes from other systems are allowed
        if (bindingStrength !== 'required' && !this.valueSetContainsSystem(resolvedVs, system)) {
          return {valid: true};
        }

        // If the system is trusted (e.g. ISO 639) and the ValueSet doesn't enumerate
        // codes for it (just references the system), accept — failure is due to missing
        // CodeSystem data, not an actually invalid code
        if (TRUSTED_SYSTEMS.has(system) && !this.codeSystems.has(system)
            && !this.valueSetHasExplicitCodes(resolvedVs, system)) {
          return {valid: true};
        }

        // If local validation fails and Nictiz is available, validate against CodeSystem
        // (not the ValueSet — Nictiz may not have FHIR core ValueSets like observation-codes)
        if (this.nictizClient && !this.options.disableExternalCalls) {
          return this.validateViaNictiz(system, code, undefined, bindingStrength);
        }

        return localResult;
      }

      // Fallback to Nictiz terminologieserver (if configured)
      if (this.nictizClient && !this.options.disableExternalCalls) {
        return this.validateViaNictiz(system, code, valueSetUrl, bindingStrength);
      }

      // Fallback to generic external server (if allowed)
      if (this.options.externalTxServer && !this.options.disableExternalCalls) {
        return this.validateExternal(system, code, valueSetUrl);
      }

      // No ValueSet available — cannot validate, treat as valid
      return {
        valid: true,
        message: `ValueSet ${valueSetUrl} not locally loaded, validation skipped`
      };
    }

    // 2. Validate directly against CodeSystem
    const cs = this.codeSystems.get(system) ?? await this.resolveCodeSystemFromArtDecor(system);

    if (cs) {
      return this.validateAgainstCodeSystem(code, cs);
    }

    // 3. Pattern validation for known systems
    const validator = PATTERN_VALIDATORS[system];

    if (validator) {

      const valid = typeof validator === 'function' ? validator(code) : validator.test(code);

      return {
        valid,
        message: valid ? undefined : `Code does not match the expected format for ${system}`
      };
    }

    // 4. Trusted systems
    if (TRUSTED_SYSTEMS.has(system)) {
      return {valid: true};
    }

    // 5. Nictiz terminologieserver for unknown systems
    if (this.nictizClient && !this.options.disableExternalCalls) {
      return this.validateViaNictiz(system, code, undefined, bindingStrength);
    }

    // 6. Unknown system
    return {
      valid: true,
      message: `System '${system}' not locally available, validation skipped`
    };
  }

  private validateAgainstValueSet(system: string, code: string, vs: ValueSet): CodeValidationResult {

    // Try expansion first (most complete)
    if (vs.expansion?.contains) {
      const found = vs.expansion.contains.find(
        c => c.system === system && c.code === code
      );

      if (found) {
        return {valid: true, display: found.display};
      }

      return {valid: false, message: `Code not found in expansion of ${vs.url}`};
    }

    // Compose-based validation
    for (const include of vs.compose?.include ?? []) {
      if (include.system && include.system !== system) {
        continue;
      }

      // Explicitly enumerated codes
      if (include.concept) {
        const found = include.concept.find(c => c.code === code);

        if (found) {
          return {valid: true, display: found.display};
        }
      }

      // Nested ValueSets
      for (const nestedUrl of include.valueSet ?? []) {
        const nested = this.valueSets.get(nestedUrl);

        if (nested) {
          const result = this.validateAgainstValueSet(system, code, nested);

          if (result.valid) {
            return result;
          }
        }
      }

      // No filter and no explicit codes: validate via CodeSystem
      if (!include.concept && !include.filter) {
        const cs = this.codeSystems.get(system);

        if (cs) {
          return this.validateAgainstCodeSystem(code, cs);
        }
      }
    }

    return {
      valid: false,
      message: `Code not found in ValueSet ${vs.url}`
    };
  }

  private validateAgainstCodeSystem(code: string, cs: CodeSystem): CodeValidationResult {

    if (cs.content === 'not-present') {
      return {valid: true, message: 'CodeSystem has no local content'};
    }

    const found = this.findInConcepts(code, cs.concept ?? []);

    if (found) {
      return {valid: true, display: found.display};
    }

    return {
      valid: false,
      message: `Code not found in CodeSystem ${cs.url}`
    };
  }

  private findInConcepts(code: string, concepts: CodeSystemConcept[]): CodeSystemConcept | undefined {

    for (const concept of concepts) {

      if (concept.code === code) {
        return concept;
      }

      if (concept.concept) {
        const found = this.findInConcepts(code, concept.concept);

        if (found) {
          return found;
        }
      }
    }

    return undefined;
  }

  private isRateLimited(): boolean {

    const now = Date.now();
    const windowMs = 60_000;
    this.externalCallTimestamps = this.externalCallTimestamps.filter(t => now - t < windowMs);

    return this.externalCallTimestamps.length >= (this.options.externalRateLimit ?? 30);
  }

  private async validateExternal(system: string, code: string, valueSetUrl: string): Promise<CodeValidationResult> {

    const cacheKey = `${system}|${code}|${valueSetUrl}`;

    if (this.externalCache.has(cacheKey)) {
      return this.externalCache.get(cacheKey)!;
    }

    if (this.isRateLimited()) {
      return {
        valid: true,
        message: 'External terminology validation skipped (rate limit reached)'
      };
    }

    try {

      this.externalCallTimestamps.push(Date.now());

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.externalTimeoutMs
      );

      const url = `${this.options.externalTxServer}/ValueSet/$validate-code` +
        `?system=${encodeURIComponent(system)}` +
        `&code=${encodeURIComponent(code)}` +
        `&url=${encodeURIComponent(valueSetUrl)}`;

      const res = await fetch(url, {signal: controller.signal});
      clearTimeout(timeout);

      const params = await res.json() as {
        parameter?: { name: string; valueBoolean?: boolean; valueString?: string }[]
      };

      const result = params.parameter?.find(p => p.name === 'result');
      const message = params.parameter?.find(p => p.name === 'message');
      const display = params.parameter?.find(p => p.name === 'display');

      const validation: CodeValidationResult = {
        valid: result?.valueBoolean === true,
        message: message?.valueString,
        display: display?.valueString
      };

      this.externalCache.set(cacheKey, validation);

      return validation;
    } catch {
      return {
        valid: true,
        message: `External validation failed for ${system}|${code}`
      };
    }
  }

  private async validateViaNictiz(system: string, code: string, valueSetUrl?: string, _bindingStrength: BindingStrength = 'required'): Promise<CodeValidationResult> {

    if (!this.nictizClient) {
      return {valid: true, message: 'Nictiz client not configured'};
    }

    if (this.isRateLimited()) {
      return {valid: true, message: 'Nictiz validation skipped (rate limit reached)'};
    }

    this.externalCallTimestamps.push(Date.now());
    const result = await this.nictizClient.validateCode(system, code, valueSetUrl);

    // If the server says the system/CodeSystem can't be resolved (not that the code is wrong
    // within a known system), accept — we can't validate what we can't resolve
    if (!result.valid && result.message
        && /could not be resolved|unknown code system|not supported/i.test(result.message)) {
      return {valid: true, message: `System '${system}' not resolvable by terminology server, validation skipped`};
    }

    return {
      valid: result.valid,
      display: result.display,
      message: result.message,
    };
  }

  /**
   * Infer the code system URL from a loaded ValueSet.
   * Looks at compose.include[0].system of the ValueSet.
   */
  inferSystemFromValueSet(valueSetUrl: string): string | undefined {

    const vsUrlClean = valueSetUrl.split('|')[0];
    const vs = this.valueSets.get(valueSetUrl) ?? this.valueSets.get(vsUrlClean);

    if (!vs) {
      return undefined;
    }

    return vs.compose?.include?.[0]?.system;
  }

  /**
   * Infer all code system URLs from a loaded ValueSet.
   * Returns systems from all compose.include entries.
   */
  inferSystemsFromValueSet(valueSetUrl: string): string[] {

    const vsUrlClean = valueSetUrl.split('|')[0];
    const vs = this.valueSets.get(valueSetUrl) ?? this.valueSets.get(vsUrlClean);

    if (!vs) {
      return [];
    }

    return (vs.compose?.include ?? [])
      .map(inc => inc.system)
      .filter((s): s is string => !!s);
  }

  /**
   * Check if a ValueSet has explicit concept codes for a given system
   * (as opposed to just referencing the system without enumerating codes).
   */
  private valueSetHasExplicitCodes(vs: ValueSet, system: string): boolean {

    if (vs.expansion?.contains) {
      return vs.expansion.contains.some(c => c.system === system);
    }

    return (vs.compose?.include ?? []).some(
      inc => inc.system === system && inc.concept && inc.concept.length > 0
    );
  }

  /**
   * Check if a ValueSet references a given system in its compose.include or expansion.
   */
  private valueSetContainsSystem(vs: ValueSet, system: string): boolean {

    if (vs.expansion?.contains) {
      return vs.expansion.contains.some(c => c.system === system);
    }

    return (vs.compose?.include ?? []).some(inc => inc.system === system);
  }

  /**
   * Try to fetch a ValueSet from art-decor and register it locally for future lookups.
   */
  private async resolveValueSetFromArtDecor(url: string): Promise<ValueSet | null> {

    if (!this.artDecorClient) {
      return null;
    }

    const vs = await this.artDecorClient.fetchValueSet(url);

    if (vs) {
      this.registerValueSet(vs);

      // Also register any CodeSystems referenced in compose.include that have explicit concepts
      for (const include of vs.compose?.include ?? []) {
        if (include.system && include.concept?.length && !this.codeSystems.has(include.system)) {
          this.registerCodeSystem({
            resourceType: 'CodeSystem',
            url: include.system,
            status: 'active',
            content: 'complete',
            concept: include.concept.map(c => ({code: c.code, display: c.display})),
          });
        }
      }
    }

    return vs;
  }

  /**
   * Try to fetch a CodeSystem from art-decor and register it locally for future lookups.
   */
  private async resolveCodeSystemFromArtDecor(systemUrl: string): Promise<CodeSystem | null> {

    if (!this.artDecorClient) {
      return null;
    }

    const cs = await this.artDecorClient.fetchCodeSystem(systemUrl);

    if (cs) {
      this.registerCodeSystem(cs);
    }

    return cs;
  }

  stats(): { valueSets: number; codeSystems: number; cachedLookups: number; nictizConfigured: boolean } {
    return {
      valueSets: this.valueSets.size,
      codeSystems: this.codeSystems.size,
      cachedLookups: this.externalCache.size + (this.nictizClient?.cacheSize ?? 0),
      nictizConfigured: this.nictizClient !== null,
    };
  }
}

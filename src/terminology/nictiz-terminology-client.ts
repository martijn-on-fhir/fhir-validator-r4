// src/terminology/nictiz-terminology-client.ts

export interface NictizTerminologyConfig {
  baseUrl: string;
  authUrl: string;
  user: string;
  password: string;
  clientId: string;
  grantType: string;
  /** Override system versions sent to the server, e.g. { "http://snomed.info/sct": "http://snomed.info/sct/11000146104/version/20260228" } */
  systemVersions?: Record<string, string>;
}

interface OAuthToken {
  accessToken: string;
  expiresAt: number;
}

export interface NictizValidationResult {
  valid: boolean;
  display?: string;
  message?: string;
}

// Default system versions for the Dutch Nictiz terminologieserver.
// SNOMED CT NL edition (11000146104) — uses the latest available version.
const DEFAULT_SYSTEM_VERSIONS: Record<string, string> = {
  'http://snomed.info/sct': 'http://snomed.info/sct/11000146104/version/20260228',
};

export class NictizTerminologyClient {
  private config: NictizTerminologyConfig;
  private token: OAuthToken | null = null;
  private cache = new Map<string, NictizValidationResult>();

  constructor(config: NictizTerminologyConfig) {
    this.config = config;
  }

  private async authenticate(): Promise<string> {
    // Return cached token if still valid (with 30s margin)
    if (this.token && Date.now() < this.token.expiresAt - 30_000) {
      return this.token.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: this.config.grantType,
      client_id: this.config.clientId,
      username: this.config.user,
      password: this.config.password,
    });

    const res = await fetch(this.config.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`Nictiz auth failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as { access_token: string; expires_in: number };

    this.token = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return this.token.accessToken;
  }

  async validateCode(system: string, code: string, valueSetUrl?: string): Promise<NictizValidationResult> {
    const cacheKey = `${system}|${code}|${valueSetUrl ?? ''}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const accessToken = await this.authenticate();

      const systemVersion = this.config.systemVersions?.[system] ?? DEFAULT_SYSTEM_VERSIONS[system];
      let endpoint: string;
      let body: Record<string, unknown>;

      if (valueSetUrl) {
        endpoint = `${this.config.baseUrl}/fhir/ValueSet/$validate-code`;
        body = this.buildParameters([
          { name: 'url', valueUri: valueSetUrl.split('|')[0] },
          { name: 'system', valueUri: system },
          { name: 'code', valueCode: code },
          ...(systemVersion ? [{ name: 'systemVersion', valueString: systemVersion }] : []),
        ]);
      } else {
        // Use $lookup for CodeSystem validation — more widely supported than $validate-code
        endpoint = `${this.config.baseUrl}/fhir/CodeSystem/$lookup`;
        body = this.buildParameters([
          { name: 'system', valueUri: system },
          { name: 'code', valueCode: code },
          ...(systemVersion ? [{ name: 'version', valueString: systemVersion }] : []),
        ]);
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/fhir+json',
          'Accept': 'application/fhir+json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json() as {
        resourceType?: string;
        parameter?: { name: string; valueBoolean?: boolean; valueString?: string }[];
        issue?: { severity: string; diagnostics?: string }[];
      };

      let result: NictizValidationResult;

      if (!res.ok) {
        if (valueSetUrl) {
          return { valid: true, message: `Nictiz server returned ${res.status}, validation skipped` };
        }

        // $lookup error — distinguish "code not found" from "system unavailable"
        const diag = data.issue?.[0]?.diagnostics ?? '';
        const systemUnavailable = diag.includes('Could not find the code system') || diag.includes('could not be found');

        if (systemUnavailable) {
          result = { valid: true, message: `CodeSystem ${system} not available on Nictiz, validation skipped` };
        } else {
          result = { valid: false, message: diag || `Code not found in ${system}` };
        }
      } else if (!valueSetUrl) {
        // $lookup success — the code exists, extract display name
        const displayParam = data.parameter?.find(p => p.name === 'display');
        result = { valid: true, display: displayParam?.valueString };
      } else {
        // $validate-code success — check the result parameter
        const resultParam = data.parameter?.find(p => p.name === 'result');
        const displayParam = data.parameter?.find(p => p.name === 'display');
        const messageParam = data.parameter?.find(p => p.name === 'message');
        result = { valid: resultParam?.valueBoolean === true, display: displayParam?.valueString, message: messageParam?.valueString };
      }

      this.cache.set(cacheKey, result);

      return result;
    } catch (e) {
      return {
        valid: true,
        message: `Nictiz terminology validation failed: ${(e as Error).message}`,
      };
    }
  }

  private buildParameters(params: Record<string, string>[]): Record<string, unknown> {
    return {
      resourceType: 'Parameters',
      parameter: params.map(p => {
        const { name, ...rest } = p;
        return { name, ...rest };
      }),
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}

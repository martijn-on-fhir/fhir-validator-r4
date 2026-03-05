// src/terminology/nictiz-terminology-client.ts

export interface NictizTerminologyConfig {
  baseUrl: string;
  authUrl: string;
  user: string;
  password: string;
  clientId: string;
  grantType: string;
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

      const params = new URLSearchParams({
        system,
        code,
      });

      if (valueSetUrl) {
        params.set('url', valueSetUrl.split('|')[0]);
      }

      const endpoint = valueSetUrl
        ? `${this.config.baseUrl}/fhir/ValueSet/$validate-code`
        : `${this.config.baseUrl}/fhir/CodeSystem/$validate-code`;

      const res = await fetch(`${endpoint}?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/fhir+json',
        },
      });

      if (!res.ok) {
        return { valid: true, message: `Nictiz server returned ${res.status}, validation skipped` };
      }

      const data = await res.json() as {
        parameter?: { name: string; valueBoolean?: boolean; valueString?: string }[];
      };

      const resultParam = data.parameter?.find(p => p.name === 'result');
      const displayParam = data.parameter?.find(p => p.name === 'display');
      const messageParam = data.parameter?.find(p => p.name === 'message');

      const result: NictizValidationResult = {
        valid: resultParam?.valueBoolean === true,
        display: displayParam?.valueString,
        message: messageParam?.valueString,
      };

      this.cache.set(cacheKey, result);

      return result;
    } catch (e) {
      return {
        valid: true,
        message: `Nictiz terminology validation failed: ${(e as Error).message}`,
      };
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}

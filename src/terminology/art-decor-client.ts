// src/terminology/art-decor-client.ts

import type { ValueSet, CodeSystem } from '../types/fhir';

const ART_DECOR_BASE = 'https://decor.nictiz.nl/fhir';

export class ArtDecorClient {

  private baseUrl: string;
  private timeoutMs: number;
  private failedUrls = new Set<string>();

  constructor(baseUrl: string = ART_DECOR_BASE, timeoutMs: number = 10_000) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Fetch a ValueSet by its canonical URL.
   * Only attempts URLs that look like art-decor ValueSet URLs.
   */
  async fetchValueSet(url: string): Promise<ValueSet | null> {

    if (this.failedUrls.has(url)) {
      return null;
    }

    // Only fetch from art-decor-style URLs
    if (!this.isArtDecorValueSetUrl(url)) {
      return null;
    }

    try {
      const res = await this.fetchWithTimeout(url);

      if (!res.ok) {
        this.failedUrls.add(url);

        return null;
      }

      const data = await res.json() as Record<string, unknown>;

      if (data.resourceType !== 'ValueSet' || !data.url) {
        this.failedUrls.add(url);

        return null;
      }

      return data as unknown as ValueSet;
    } catch {
      this.failedUrls.add(url);

      return null;
    }
  }

  /**
   * Fetch a CodeSystem by its URL.
   * Supports urn:oid: systems by searching on decor.nictiz.nl.
   */
  async fetchCodeSystem(systemUrl: string): Promise<CodeSystem | null> {

    if (this.failedUrls.has(systemUrl)) {
      return null;
    }

    // Only attempt urn:oid: systems — these are typically Dutch/international OID-based systems
    if (!systemUrl.startsWith('urn:oid:')) {
      return null;
    }

    try {
      const searchUrl = `${this.baseUrl}/CodeSystem?url=${encodeURIComponent(systemUrl)}`;
      const res = await this.fetchWithTimeout(searchUrl);

      if (!res.ok) {
        this.failedUrls.add(systemUrl);

        return null;
      }

      const bundle = await res.json() as {
        resourceType?: string;
        entry?: { resource?: Record<string, unknown> }[];
      };

      const cs = bundle.entry?.[0]?.resource;

      if (!cs || cs.resourceType !== 'CodeSystem') {
        this.failedUrls.add(systemUrl);

        return null;
      }

      return cs as unknown as CodeSystem;
    } catch {
      this.failedUrls.add(systemUrl);

      return null;
    }
  }

  private isArtDecorValueSetUrl(url: string): boolean {
    return url.startsWith('http://decor.nictiz.nl/fhir/ValueSet/') ||
           url.startsWith('https://decor.nictiz.nl/fhir/ValueSet/');
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/fhir+json, application/json' },
      });

      return res;
    } finally {
      clearTimeout(timeout);
    }
  }
}

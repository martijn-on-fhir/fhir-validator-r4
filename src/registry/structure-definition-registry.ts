// src/registry/structure-definition-registry.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type {StructureDefinition, ElementDefinition} from '../types/fhir';
import type {IndexEntry} from './file-index';

export class StructureDefinitionRegistry {

  private definitions = new Map<string, StructureDefinition>();
  /** Maps lookup key (url/name/id) → filePath for lazy loading */
  private lazyIndex = new Map<string, string>();
  /** Tracks which files have already been loaded */
  private loadedFiles = new Set<string>();
  /** Cache for resolved (flattened) element lists, keyed by SD url */
  private elementsCache = new Map<string, ElementDefinition[]>();

  /**
   * Register index entries for lazy loading.
   * Files are not read until resolve() is called.
   */
  registerIndex(entries: IndexEntry[]): void {
    for (const entry of entries) {
      this.lazyIndex.set(entry.url, entry.filePath);

      if (entry.name) {
        this.lazyIndex.set(entry.name, entry.filePath);
      }

      if (entry.id) {
        this.lazyIndex.set(entry.id, entry.filePath);
      }
    }
  }

  /**
   * Load all StructureDefinitions from a directory (recursive)
   */
  async loadFromDirectory(dirPath: string): Promise<void> {

    const entries = await fs.readdir(dirPath, {withFileTypes: true});

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

        if (content.resourceType === 'StructureDefinition') {
          this.register(content as StructureDefinition);
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  /**
   * Register a StructureDefinition manually
   */
  register(sd: StructureDefinition): void {
    this.definitions.set(sd.url, sd);

    if (sd.name) {
      this.definitions.set(sd.name, sd);
    }

    if (sd.id) {
      this.definitions.set(sd.id, sd);
    }
  }

  /**
   * Resolve by URL, name or id — loads from disk on first access if indexed.
   */
  resolve(urlOrName: string): StructureDefinition | undefined {
    // Strip version suffix if present: url|4.0.1 -> url
    const clean = urlOrName.split('|')[0];

    const cached = this.definitions.get(clean);

    if (cached) {
      return cached;
    }

    // Try lazy loading from index
    const filePath = this.lazyIndex.get(clean);

    if (filePath && !this.loadedFiles.has(filePath)) {
      this.loadFileSync(filePath);

      return this.definitions.get(clean);
    }

    return undefined;
  }

  /**
   * Return the fully flattened element list,
   * including elements from the base definition (inheritance)
   */
  resolveElements(sd: StructureDefinition): ElementDefinition[] {
    const cached = this.elementsCache.get(sd.url);

    if (cached) {
      return cached;
    }

    // Use snapshot if available (most complete)
    const ownElements = sd.snapshot?.element ?? sd.differential?.element ?? [];

    if (!sd.baseDefinition) {
      const result = [...ownElements];
      this.elementsCache.set(sd.url, result);

      return result;
    }

    const base = this.resolve(sd.baseDefinition);

    if (!base) {
      const result = [...ownElements];
      this.elementsCache.set(sd.url, result);

      return result;
    }

    const baseElements = this.resolveElements(base);

    // Merge: profile elements override base by path
    const merged = new Map<string, ElementDefinition>();

    for (const el of baseElements) {
      merged.set(el.path, el);
    }

    for (const el of ownElements) {
      // Sliced elements have path + sliceName
      const key = el.sliceName ? `${el.path}:${el.sliceName}` : el.path;
      merged.set(key, el);
    }

    const result = Array.from(merged.values());
    this.elementsCache.set(sd.url, result);

    return result;
  }

  /**
   * Return all registered URLs
   */
  listUrls(): string[] {
    // Include both loaded and indexed URLs
    const urls = new Set<string>();

    for (const key of this.definitions.keys()) {
      if (key.startsWith('http')) {
        urls.add(key);
      }
    }

    for (const key of this.lazyIndex.keys()) {
      if (key.startsWith('http')) {
        urls.add(key);
      }
    }

    return Array.from(urls);
  }

  size(): number {
    return this.listUrls().length;
  }

  /**
   * Preload all indexed files into memory (parallel async reads).
   * Call after create() for batch validation scenarios.
   */
  async preload(): Promise<void> {
    const filePaths = new Set(this.lazyIndex.values());
    const unloaded = [...filePaths].filter(f => !this.loadedFiles.has(f));

    await Promise.all(unloaded.map(async (filePath) => {
      this.loadedFiles.add(filePath);

      try {
        const content = await fs.readFile(filePath, 'utf8');
        const json = JSON.parse(content);

        if (json.resourceType === 'StructureDefinition') {
          this.register(json as StructureDefinition);
        }
      } catch {
        // Skip invalid files
      }
    }));
  }

  /**
   * Synchronously load a file and register its StructureDefinition.
   * Uses readFileSync for simplicity in the resolve() hot path.
   */
  private loadFileSync(filePath: string): void {
    this.loadedFiles.add(filePath);

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const content = require('fs').readFileSync(filePath, 'utf8');
      const json = JSON.parse(content);

      if (json.resourceType === 'StructureDefinition') {
        this.register(json as StructureDefinition);
      }
    } catch {
      // Skip invalid files
    }
  }
}

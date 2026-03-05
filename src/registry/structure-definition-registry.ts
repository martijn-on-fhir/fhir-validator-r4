// src/registry/structure-definition-registry.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type {StructureDefinition, ElementDefinition} from '../types/fhir';

export class StructureDefinitionRegistry {

  private definitions = new Map<string, StructureDefinition>();

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
   * Resolve by URL, name or id
   */
  resolve(urlOrName: string): StructureDefinition | undefined {
    // Strip version suffix if present: url|4.0.1 -> url
    const clean = urlOrName.split('|')[0];

    return this.definitions.get(clean);
  }

  /**
   * Return the fully flattened element list,
   * including elements from the base definition (inheritance)
   */
  resolveElements(sd: StructureDefinition): ElementDefinition[] {
    // Use snapshot if available (most complete)
    const ownElements = sd.snapshot?.element ?? sd.differential?.element ?? [];

    if (!sd.baseDefinition) {
      return [...ownElements];
    }

    const base = this.resolve(sd.baseDefinition);

    if (!base) {
      return [...ownElements];
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

    return Array.from(merged.values());
  }

  /**
   * Return all registered URLs
   */
  listUrls(): string[] {
    return Array.from(this.definitions.keys()).filter(k => k.startsWith('http'));
  }

  size(): number {
    return this.listUrls().length;
  }
}

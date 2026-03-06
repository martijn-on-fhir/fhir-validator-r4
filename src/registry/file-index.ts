// src/registry/file-index.ts
import * as fs from 'fs/promises';
import * as path from 'path';

export interface IndexEntry {
  /** Absolute path to the JSON file */
  filePath: string;
  /** FHIR resourceType (StructureDefinition, ValueSet, CodeSystem) */
  resourceType: string;
  /** Canonical URL */
  url: string;
  /** Resource name (optional) */
  name?: string;
  /** Resource id (optional) */
  id?: string;
  /** File mtime at index time (ms since epoch) */
  mtime: number;
}

export interface FileIndexData {
  /** Index format version */
  version: 1;
  /** When the index was built */
  builtAt: string;
  /** Entries keyed by filePath */
  entries: IndexEntry[];
}

/**
 * Builds and caches a lightweight index of FHIR JSON files.
 * Instead of parsing entire files, it extracts only the metadata
 * needed for lazy loading (resourceType, url, name, id).
 */
export class FileIndex {

  private entries: IndexEntry[] = [];

  /** Scan directories and build the index. */
  async buildFromDirectories(dirs: string[]): Promise<void> {
    for (const dir of dirs) {
      await this.scanDirectory(dir);
    }
  }

  /** Load a previously saved index from disk. Returns false if stale or missing. */
  async loadFromCache(cachePath: string, _dirs: string[]): Promise<boolean> {
    try {
      const content = await fs.readFile(cachePath, 'utf8');
      const data: FileIndexData = JSON.parse(content);

      if (data.version !== 1 || !Array.isArray(data.entries)) {
        return false;
      }

      // Verify a sample of entries still have matching mtimes
      const sample = data.entries.filter((_, i) => i % 50 === 0);

      for (const entry of sample) {
        try {
          const stat = await fs.stat(entry.filePath);

          if (stat.mtimeMs !== entry.mtime) {
            return false;
          }
        } catch {
          return false; // File was deleted
        }
      }

      this.entries = data.entries;

      return true;
    } catch {
      return false;
    }
  }

  /** Save the current index to disk for future reuse. */
  async saveToCache(cachePath: string): Promise<void> {
    const data: FileIndexData = {
      version: 1,
      builtAt: new Date().toISOString(),
      entries: this.entries,
    };

    await fs.writeFile(cachePath, JSON.stringify(data), 'utf8');
  }

  /** Get all entries of a given resourceType. */
  getEntries(resourceType: string): IndexEntry[] {
    return this.entries.filter(e => e.resourceType === resourceType);
  }

  /** Total number of indexed files. */
  get size(): number {
    return this.entries.length;
  }

  private async scanDirectory(dirPath: string): Promise<void> {
    let entries: import('fs').Dirent[];

    try {
      entries = await fs.readdir(dirPath, {withFileTypes: true});
    } catch {
      return;
    }

    const promises: Promise<void>[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        promises.push(this.scanDirectory(fullPath));
        continue;
      }

      if (!entry.name.endsWith('.json')) {
        continue;
      }

      promises.push(this.indexFile(fullPath));
    }

    await Promise.all(promises);
  }

  private async indexFile(filePath: string): Promise<void> {
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        fs.stat(filePath),
      ]);

      const json = JSON.parse(content);
      const rt = json.resourceType;

      if (rt === 'StructureDefinition' || rt === 'ValueSet' || rt === 'CodeSystem') {
        this.entries.push({
          filePath,
          resourceType: rt,
          url: json.url,
          name: json.name,
          id: json.id,
          mtime: stat.mtimeMs,
        });
      }
    } catch {
      // Skip invalid files
    }
  }
}

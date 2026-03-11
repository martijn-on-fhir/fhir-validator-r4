// src/sources/mongo-source.ts
import type { ResourceSource } from './resource-source';

/**
 * Minimal subset of MongoDB Collection used by MongoSource.
 * The consumer provides a real Collection instance — no mongodb dependency needed.
 */
export interface MongoCollection {
  find(filter?: Record<string, unknown>): { toArray(): Promise<Record<string, unknown>[]> };
  replaceOne?(filter: Record<string, unknown>, replacement: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Loads FHIR conformance resources from a MongoDB collection.
 *
 * Expected document shape: standard FHIR JSON with at least `resourceType` and `url` fields.
 * The `_id` field (added by MongoDB) is automatically stripped.
 *
 * @example
 * ```ts
 * const collection = client.db('fhir').collection('conformance_resources');
 * const source = new MongoSource(collection);
 * ```
 */
export class MongoSource implements ResourceSource {

  constructor(private collection: MongoCollection, private filter: Record<string, unknown> = {}) {}

  async loadAll(): Promise<Record<string, unknown>[]> {
    const docs = await this.collection.find({
      resourceType: { $in: ['StructureDefinition', 'ValueSet', 'CodeSystem'] },
      ...this.filter,
    }).toArray();

    // Strip MongoDB _id field
    for (const doc of docs) {
      delete doc._id;
    }

    return docs;
  }

  async save(resource: Record<string, unknown>): Promise<void> {
    if (!this.collection.replaceOne) {
      return;
    }

    const url = resource.url as string;

    if (!url) {
      return;
    }

    await this.collection.replaceOne({ url }, resource, { upsert: true });
  }
}
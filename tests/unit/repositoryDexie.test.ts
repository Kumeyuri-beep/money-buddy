import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { MoneyDB } from '../../src/storage/db';
import { createDexieRepository } from '../../src/storage/ledgerRepository';
import { describeRepositoryContract } from './repositoryContract';

const opened: MoneyDB[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((d) => d.delete()));
});

describeRepositoryContract('Dexie (IndexedDB)', async () => {
  const db = new MoneyDB(`contract-${Math.random().toString(36).slice(2)}`);
  opened.push(db);
  return createDexieRepository(db);
});

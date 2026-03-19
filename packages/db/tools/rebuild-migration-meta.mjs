import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import * as schema from '../src/schema/index.ts';

const require = createRequire(import.meta.url);
const { generateDrizzleJson } = require('drizzle-kit/api');

const rootDir = resolve(import.meta.dirname, '..');
const metaDir = resolve(rootDir, 'migrations', 'meta');
const journalPath = resolve(metaDir, '_journal.json');
const snapshot0007Path = resolve(metaDir, '0007_snapshot.json');
const snapshot0008Path = resolve(metaDir, '0008_snapshot.json');
const snapshot0009Path = resolve(metaDir, '0009_snapshot.json');
const snapshot0010Path = resolve(metaDir, '0010_snapshot.json');
const snapshot0011Path = resolve(metaDir, '0011_snapshot.json');

function dropContentFolderState(snapshot) {
  const next = structuredClone(snapshot);
  delete next.tables['public.content_folders'];
  delete next.tables['public.canvas_projects'];
  delete next.tables['public.smart_views'];

  const contentItems = next.tables['public.content_items'];
  if (!contentItems) {
    throw new Error('content_items table missing from generated snapshot');
  }

  delete contentItems.columns.folder_id;
  for (const [key, foreignKey] of Object.entries(contentItems.foreignKeys)) {
    if (foreignKey.tableTo === 'content_folders' || foreignKey.columnsFrom.includes('folder_id')) {
      delete contentItems.foreignKeys[key];
    }
  }

  if (next.internal?.tables?.['public.content_items']?.columns) {
    delete next.internal.tables['public.content_items'].columns.folder_id;
  }

  if (next.internal?.tables?.['public.content_folders']) {
    delete next.internal.tables['public.content_folders'];
  }

  if (next.internal?.tables?.['public.canvas_projects']) {
    delete next.internal.tables['public.canvas_projects'];
  }

  if (next.internal?.tables?.['public.smart_views']) {
    delete next.internal.tables['public.smart_views'];
  }

  return next;
}

function dropCanvasAndSmartViewState(snapshot) {
  const next = structuredClone(snapshot);
  delete next.tables['public.canvas_projects'];
  delete next.tables['public.smart_views'];

  if (next.internal?.tables?.['public.canvas_projects']) {
    delete next.internal.tables['public.canvas_projects'];
  }

  if (next.internal?.tables?.['public.smart_views']) {
    delete next.internal.tables['public.smart_views'];
  }

  return next;
}

function dropSmartViewState(snapshot) {
  const next = structuredClone(snapshot);
  delete next.tables['public.smart_views'];

  if (next.internal?.tables?.['public.smart_views']) {
    delete next.internal.tables['public.smart_views'];
  }

  return next;
}

function upsertJournalEntry(entries, idx, tag, when) {
  const nextEntry = {
    idx,
    version: '7',
    when,
    tag,
    breakpoints: true,
  };

  const existingIndex = entries.findIndex((entry) => entry.idx === idx || entry.tag === tag);
  if (existingIndex === -1) {
    entries.push(nextEntry);
    return;
  }

  entries[existingIndex] = nextEntry;
}

const [journalRaw, snapshot0007Raw] = await Promise.all([
  readFile(journalPath, 'utf8'),
  readFile(snapshot0007Path, 'utf8'),
]);

const journal = JSON.parse(journalRaw);
const snapshot0007 = JSON.parse(snapshot0007Raw);
const generated0008 = generateDrizzleJson(schema, snapshot0007.id);
const snapshot0008 = dropContentFolderState(generateDrizzleJson(schema, snapshot0007.id));
const snapshot0009 = dropCanvasAndSmartViewState(generateDrizzleJson(schema, snapshot0008.id));
const snapshot0010 = dropSmartViewState(generateDrizzleJson(schema, snapshot0009.id));
const snapshot0011 = generateDrizzleJson(schema, snapshot0010.id);

const now = Date.now();
upsertJournalEntry(journal.entries, 8, '0008_tizen_device_expansion', now);
upsertJournalEntry(journal.entries, 9, '0009_content_folders', now + 1);
upsertJournalEntry(journal.entries, 10, '0010_canvas_projects', now + 2);
upsertJournalEntry(journal.entries, 11, '0011_smart_views', now + 3);
journal.entries.sort((left, right) => left.idx - right.idx);

await Promise.all([
  writeFile(snapshot0008Path, `${JSON.stringify(snapshot0008, null, 2)}\n`),
  writeFile(snapshot0009Path, `${JSON.stringify(snapshot0009, null, 2)}\n`),
  writeFile(snapshot0010Path, `${JSON.stringify(snapshot0010, null, 2)}\n`),
  writeFile(snapshot0011Path, `${JSON.stringify(snapshot0011, null, 2)}\n`),
  writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`),
]);

console.log('Rebuilt Drizzle migration metadata for 0008 through 0011.');
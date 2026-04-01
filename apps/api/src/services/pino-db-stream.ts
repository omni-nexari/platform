/**
 * A writable stream that pino can pipe log records into.
 * Only persists warn + error entries to `log_entries` to keep storage lean.
 * Silently swallows every entry if the DB insert fails (never block the server).
 */

import { Writable } from 'node:stream';
import { db, logEntries } from '@signage/db';
import { logBus } from './log-bus.js';

const LEVEL_NAMES: Record<number, 'debug' | 'info' | 'warn' | 'error'> = {
  10: 'debug',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',
};

type PinoRecord = {
  level: number;
  time: number;
  msg?: string;
  err?: { message?: string; stack?: string };
  [key: string]: unknown;
};

export function createPinoDbStream(): Writable {
  return new Writable({
    objectMode: false,
    write(chunk: Buffer | string, _encoding, callback) {
      const line = chunk.toString().trim();
      if (!line) { callback(); return; }

      let record: PinoRecord;
      try {
        record = JSON.parse(line) as PinoRecord;
      } catch {
        callback();
        return;
      }

      const levelName = LEVEL_NAMES[record.level];
      // Only persist warn + error to keep storage low
      if (!levelName || levelName === 'debug' || levelName === 'info') {
        callback();
        return;
      }

      const message =
        record.msg ??
        record.err?.message ??
        '(no message)';

      // Strip high-cardinality / large fields before storing as meta
      const { level: _l, time: _t, pid: _p, hostname: _h, msg: _m, ...rest } = record;
      const meta = Object.keys(rest).length > 0 ? rest : undefined;

      // Fire-and-forget — never let a DB failure block the log write
      db.insert(logEntries).values({
        source:    'api',
        level:     levelName,
        message:   message.slice(0, 4_000),
        meta:      meta ?? null,
        createdAt: record.time ? new Date(record.time) : new Date(),
      }).returning().then((rows) => {
        logBus.publish(rows as Parameters<typeof logBus.publish>[0]);
      }).catch(() => { /* intentional no-op */ });

      callback();
    },
  });
}

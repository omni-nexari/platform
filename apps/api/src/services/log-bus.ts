/**
 * In-process event bus for newly inserted log entries.
 *
 * The ingest route emits on this bus after each successful DB insert.
 * The /logs/tail WebSocket endpoint subscribes to receive live entries and
 * forwards matching rows to connected browser clients.
 *
 * This is intentionally kept simple — a single EventEmitter works fine for
 * one API process.  If the deployment ever moves to multiple replicas, swap
 * this for a Redis pub/sub channel publishing the same JSON payload.
 */

import { EventEmitter } from 'node:events';

export interface LogBusEntry {
  id:         number;
  source:     string;
  level:      string;
  message:    string;
  meta:       Record<string, unknown> | null;
  orgId:      string | null;
  deviceId:   string | null;
  userId:     string | null;
  appVersion: string | null;
  createdAt:  Date;
}

class LogBus extends EventEmitter {
  /** Emit after a batch of rows has been persisted. */
  publish(entries: LogBusEntry[]): void {
    for (const entry of entries) {
      this.emit('entry', entry);
    }
  }
}

export const logBus = new LogBus();
// Allow many tail WS connections without Node.js warning about listener leaks.
logBus.setMaxListeners(256);

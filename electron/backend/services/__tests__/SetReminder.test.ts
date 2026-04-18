/**
 * Tests for the set_reminder tool — verifies the INSERT populates BOTH
 * `due_at` (added in migration v8) AND `scheduled_at` (declared NOT NULL in v1)
 * so the reminders row satisfies the NOT NULL constraint AND is visible to
 * ReminderService (which queries by due_at).
 *
 * Regression guard for the 11-hour trial bug:
 *   "NOT NULL constraint failed: reminders.scheduled_at"
 *
 * Uses a pure-JS fake that mimics better-sqlite3's `prepare/run` API so
 * the test does NOT depend on the Electron-compiled native binding.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal SQL fake: stores rows in a Map keyed by column name and captures
// the most recent INSERT statement + bindings for inspection.
// ---------------------------------------------------------------------------
type Row = Record<string, any>;

interface FakeDb {
  rows: Row[];
  lastInsertSql: string | null;
  lastInsertBindings: any[] | null;
  prepare: (sql: string) => { run: (...args: any[]) => any; get: (...args: any[]) => any; all: (...args: any[]) => any[] };
}

function createFakeDb(): FakeDb {
  const db: FakeDb = {
    rows: [],
    lastInsertSql: null,
    lastInsertBindings: null,
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        run: (...args: any[]) => {
          if (/^INSERT INTO reminders/i.test(normalized)) {
            db.lastInsertSql = normalized;
            db.lastInsertBindings = args;

            // Parse column list between parens
            const colsMatch = normalized.match(
              /INSERT INTO reminders \(([^)]+)\) VALUES/i
            );
            if (!colsMatch) {
              throw new Error(`Unexpected INSERT shape: ${normalized}`);
            }
            const cols = colsMatch[1]
              .split(',')
              .map((c) => c.trim());

            // Enforce NOT NULL constraint on scheduled_at (mirrors v1 schema)
            const schedIdx = cols.indexOf('scheduled_at');
            if (schedIdx === -1 || args[schedIdx] == null) {
              const err: any = new Error(
                'NOT NULL constraint failed: reminders.scheduled_at'
              );
              err.code = 'SQLITE_CONSTRAINT_NOTNULL';
              throw err;
            }

            // Store the row
            const row: Row = {};
            cols.forEach((c, i) => (row[c] = args[i]));
            db.rows.push(row);
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: () => db.rows[0],
        all: () => db.rows.slice(),
      };
    },
  };
  return db;
}

let fakeDb: FakeDb;

vi.mock('../../logger', () => ({
  log: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

vi.mock('../../database', () => ({
  getDatabase: () => fakeDb,
}));

// Import AFTER the mock is in place
import { setReminder } from '../../tools/setReminder';

const ctx = { userId: 'user-123', chatGuid: 'iMessage;-;+15551234567' };

function isoOffsetMinutes(mins: number): string {
  return new Date(Date.now() + mins * 60_000).toISOString();
}

describe('setReminder tool', () => {
  beforeEach(() => {
    fakeDb = createFakeDb();
    vi.clearAllMocks();
  });

  it('inserts with BOTH scheduled_at and due_at columns populated (regression)', async () => {
    const dueAt = isoOffsetMinutes(60);

    const result = await setReminder(
      { message: 'Call the dentist', due_at: dueAt },
      ctx
    );

    expect(result).toContain('Reminder set for');
    expect(result).toContain('Call the dentist');

    // The SQL must include both columns
    expect(fakeDb.lastInsertSql).toMatch(/scheduled_at/);
    expect(fakeDb.lastInsertSql).toMatch(/due_at/);
    expect(fakeDb.lastInsertSql).toMatch(/chat_guid/);

    // The row must be stored with both values equal to the iso string
    expect(fakeDb.rows).toHaveLength(1);
    const row = fakeDb.rows[0];
    expect(row.user_id).toBe('user-123');
    expect(row.chat_guid).toBe('iMessage;-;+15551234567');
    expect(row.message).toBe('Call the dentist');
    expect(row.due_at).toBe(dueAt);
    expect(row.scheduled_at).toBe(dueAt);
  });

  it('does NOT throw the v2.4.0 NOT NULL constraint error', async () => {
    const dueAt = isoOffsetMinutes(120);

    // If scheduled_at were missing from the INSERT, our fake would throw:
    //   Error: NOT NULL constraint failed: reminders.scheduled_at
    await expect(
      setReminder({ message: 'Remember to breathe', due_at: dueAt }, ctx)
    ).resolves.toBeDefined();

    expect(fakeDb.rows).toHaveLength(1);
  });

  it('rejects a past due_at', async () => {
    const pastIso = new Date(Date.now() - 60_000).toISOString();

    await expect(
      setReminder({ message: 'too late', due_at: pastIso }, ctx)
    ).rejects.toThrow(/future/);

    expect(fakeDb.rows).toHaveLength(0);
  });

  it('rejects a due_at more than 1 year away', async () => {
    const farFuture = new Date(
      Date.now() + 400 * 24 * 60 * 60 * 1000
    ).toISOString();

    await expect(
      setReminder({ message: 'in 2030', due_at: farFuture }, ctx)
    ).rejects.toThrow(/within 1 year/);

    expect(fakeDb.rows).toHaveLength(0);
  });

  it('rejects a missing or empty message', async () => {
    const dueAt = isoOffsetMinutes(30);

    await expect(
      setReminder({ message: '', due_at: dueAt }, ctx)
    ).rejects.toThrow(/message is required/);

    await expect(
      setReminder({ due_at: dueAt } as any, ctx)
    ).rejects.toThrow(/message is required/);

    await expect(
      setReminder({ message: '   ', due_at: dueAt }, ctx)
    ).rejects.toThrow(/message is required/);

    expect(fakeDb.rows).toHaveLength(0);
  });

  it('rejects an invalid date string', async () => {
    await expect(
      setReminder({ message: 'nope', due_at: 'not a date' }, ctx)
    ).rejects.toThrow(/valid ISO 8601/);
  });

  it('rejects a missing due_at', async () => {
    await expect(
      setReminder({ message: 'nope' } as any, ctx)
    ).rejects.toThrow(/due_at is required/);
  });

  it('ReminderService-style query returns the row via due_at', async () => {
    // Simulate ReminderService.checkDueReminders() — it queries by due_at
    // and is_sent; make sure our INSERT is visible to that query.
    const dueAt = isoOffsetMinutes(1);
    await setReminder({ message: 'soon', due_at: dueAt }, ctx);

    const rows = fakeDb.rows.filter(
      (r) => (r.is_sent ?? 0) === 0 && r.due_at != null
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('soon');
    expect(rows[0].due_at).toBe(dueAt);
  });
});

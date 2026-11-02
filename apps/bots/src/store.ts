/**
 * Persistência dos bots (ADR-0037): um SQLite por processo (`node:sqlite`, sem dependência nativa) em DATA_DIR.
 * Cada bot usa suas tabelas; `kv` guarda a configuração por servidor em JSON.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kv (ns TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (ns, key));
      CREATE TABLE IF NOT EXISTS xp (guild TEXT NOT NULL, user TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0,
        last_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild, user));
      CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, guild TEXT NOT NULL, user TEXT NOT NULL,
        by_user TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS warnings_guild_user ON warnings (guild, user);
      CREATE TABLE IF NOT EXISTS giveaways (id TEXT PRIMARY KEY, guild TEXT NOT NULL, channel TEXT NOT NULL,
        message TEXT NOT NULL, prize TEXT NOT NULL, winners INTEGER NOT NULL, ends_at INTEGER NOT NULL,
        host TEXT NOT NULL, ended INTEGER NOT NULL DEFAULT 0, entrants TEXT NOT NULL DEFAULT '[]', won TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS tickets (channel TEXT PRIMARY KEY, guild TEXT NOT NULL, user TEXT NOT NULL,
        opened_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS coins (guild TEXT NOT NULL, user TEXT NOT NULL, balance INTEGER NOT NULL DEFAULT 0,
        last_daily INTEGER NOT NULL DEFAULT 0, last_work INTEGER NOT NULL DEFAULT 0, last_rob INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild, user));
      CREATE TABLE IF NOT EXISTS tags (guild TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, by_user TEXT NOT NULL,
        PRIMARY KEY (guild, name));
      CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT NOT NULL, channel TEXT NOT NULL,
        text TEXT NOT NULL, at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0);
    `);
  }

  get<T>(ns: string, key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM kv WHERE ns = ? AND key = ?').get(ns, key) as
      { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  set(ns: string, key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO kv (ns, key, value) VALUES (?, ?, ?) ON CONFLICT (ns, key) DO UPDATE SET value = excluded.value',
      )
      .run(ns, key, JSON.stringify(value));
  }

  close() {
    this.db.close();
  }
}

// npm test  (DB + schema checks only; browser tests need Chrome — see README)
process.env.DB_PATH = ':memory:';
import assert from 'assert';
import { db } from '../backend/src/db';
const ids = Array.from({ length: 50 }, (_, i) => `profile_${String(i + 1).padStart(3, '0')}`);
ids.forEach(id => db.prepare("INSERT INTO profiles(id,profile_name,storage_path,created_at) VALUES(?,?,?,datetime('now'))").run(id, id, `/tmp/${id}`));
assert.strictEqual((db.prepare('SELECT COUNT(*) c FROM profiles').get() as any).c, 50);
console.log('OK: 50 profile records created with distinct IDs');

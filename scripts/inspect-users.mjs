import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const dir = path.join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
if (!fs.existsSync(dir)) {
  console.log('No miniflare directory found.');
  process.exit(0);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
for (const f of files) {
  const fullPath = path.join(dir, f);
  console.log('\n======================================================');
  console.log('Database File:', fullPath);
  console.log('======================================================');
  const db = new DatabaseSync(fullPath);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables found:', tables.map(t => t.name).join(', '));

  for (const tbl of ['password_accounts', 'connected_drives', 'auth_sessions', 'cases']) {
    try {
      const rows = db.prepare(`SELECT * FROM ${tbl}`).all();
      console.log(`\nTable '${tbl}': ${rows.length} records`);
      if (rows.length > 0) {
        console.dir(rows, { depth: null });
      }
    } catch (e) {
      // Table might not exist yet
    }
  }

  try {
    const joined = db.prepare(`
      SELECT 
        d.id as drive_id,
        u.email,
        u.name,
        d.provider,
        d.scope,
        d.folder_name,
        d.status,
        datetime(d.updated_at, 'unixepoch') as last_connected
      FROM connected_drives d
      LEFT JOIN password_accounts u ON d.user_id = u.user_id
    `).all();
    if (joined.length > 0) {
      console.log('\n--- ACTIVE USER CONNECTED DRIVES ---');
      console.table(joined);
    }
  } catch (e) {}
}

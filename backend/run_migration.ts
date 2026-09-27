import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function runMigration() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  console.log('Running pg_trgm migration...');
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  await client.query('CREATE INDEX IF NOT EXISTS candidates_name_trgm_idx ON "candidates" USING gin (name gin_trgm_ops);');
  
  console.log('Migration complete.');
  await client.end();
}

runMigration().catch(console.error);

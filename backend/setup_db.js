const { Pool } = require('pg');
require('dotenv').config({ path: '../backend/.env' });

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('Installing pg_trgm extension...');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    console.log('✅ pg_trgm extension installed.');

    console.log('Creating trigram index on candidates.name...');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_candidates_name_trgm ON candidates USING gin (name gin_trgm_ops);');
    console.log('✅ Index idx_candidates_name_trgm created.');

    // Also check for vacancy index since we use similarity on it
    console.log('Creating trigram index on candidates.vacancy...');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_candidates_vacancy_trgm ON candidates USING gin (vacancy gin_trgm_ops);');
    console.log('✅ Index idx_candidates_vacancy_trgm created.');

  } catch (err) {
    console.error('❌ Error setting up DB:', err);
  } finally {
    await pool.end();
  }
}

run();

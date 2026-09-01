/**
 * Test Atlas connectivity and list auth-related collections.
 * Tries MONGODB_URI_STANDARD first (Windows-friendly), then MONGODB_URI.
 *
 * Usage:
 *   NODE_ENV=development node scripts/test-mongodb-connection.js
 *   NODE_ENV=test node scripts/test-mongodb-connection.js
 */
require('../load-env');
const mongoose = require('mongoose');

const dbName = process.env.MONGODB_DB_NAME || 'ecommreco_dev';

function collectUriCandidates() {
  const seen = new Set();
  const ordered = [];
  for (const key of [
    'MONGODB_URI_STANDARD',
    'MONGODB_URI',
    'MONGODB_FALLBACK_URI',
  ]) {
    const raw = process.env[key];
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      ordered.push({ key, uri: trimmed });
    }
  }
  return ordered;
}

function maskUri(uri) {
  return uri.replace(/:([^@/]+)@/, ':***@');
}

async function tryConnect(candidate) {
  const conn = await mongoose
    .createConnection(candidate.uri, {
      dbName,
      serverSelectionTimeoutMS: 15001,
    })
    .asPromise();
  return conn;
}

async function main() {
  const candidates = collectUriCandidates();
  if (candidates.length === 0) {
    console.error('No MongoDB URI configured (MONGODB_URI_STANDARD / MONGODB_URI)');
    process.exit(1);
  }

  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('MONGODB_DB_NAME:', dbName);
  console.log('USE_MEMORY_DB:', process.env.USE_MEMORY_DB ?? 'false');
  console.log('URI candidates:', candidates.map((c) => c.key).join(' → '));

  let conn;
  let usedKey;
  const errors = [];

  for (const candidate of candidates) {
    console.log(`\nTrying ${candidate.key}: ${maskUri(candidate.uri)}`);
    try {
      conn = await tryConnect(candidate);
      usedKey = candidate.key;
      break;
    } catch (err) {
      const message = err.message || String(err);
      errors.push(`${candidate.key}: ${message}`);
      if (/querySrv\s+ECONNREFUSED/i.test(message)) {
        console.warn(
          '  querySrv failed — set MONGODB_URI_STANDARD (standard mongodb:// string from Atlas).',
        );
      } else {
        console.warn(`  failed: ${message}`);
      }
    }
  }

  if (!conn) {
    console.error('\n❌ MongoDB connection failed for all candidates');
    for (const err of errors) console.error(`   - ${err}`);
    process.exit(1);
  }

  try {
    console.log(`\n✅ Connected via ${usedKey}`);
    console.log('   host:', conn.host);
    console.log('   database:', conn.db.databaseName);

    const users = conn.db.collection('users');
    const sellers = conn.db.collection('sellers');

    const userCount = await users.countDocuments();
    const sellerCount = await sellers.countDocuments();
    console.log('\nCollection counts:');
    console.log('   users:', userCount);
    console.log('   sellers:', sellerCount);

    if (userCount === 0 && sellerCount === 0) {
      console.warn(
        '\n⚠️  Database is empty. Check MONGODB_DB_NAME matches the Atlas database with your data.',
      );
    }

    const sampleUsers = await users
      .find({}, { projection: { email: 1, role: 1, status: 1 } })
      .limit(5)
      .toArray();
    console.log('\nSample users (first 5):');
    for (const u of sampleUsers) {
      console.log(`   - ${u.email} role=${u.role} status=${u.status ?? 'n/a'}`);
    }

    const sampleSellers = await sellers
      .find({}, { projection: { email: 1, onboardingStatus: 1 } })
      .limit(5)
      .toArray();
    console.log('\nSample sellers (first 5):');
    for (const s of sampleSellers) {
      console.log(
        `   - ${s.email} onboarding=${s.onboardingStatus ?? 'n/a'}`,
      );
    }

    await conn.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Error after connect:', err.message || String(err));
    process.exit(1);
  }
}

main();

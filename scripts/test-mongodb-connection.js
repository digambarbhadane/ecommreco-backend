/**
 * Test Atlas connectivity and list auth-related collections.
 * Usage: node scripts/test-mongodb-connection.js
 */
require('../load-env');
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'ecommreco_dev';

async function main() {
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  const masked = uri.replace(/:([^@/]+)@/, ':***@');
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('MONGODB_URI:', masked);
  console.log('MONGODB_DB_NAME:', dbName);
  console.log('ALLOW_MEMORY_DB_FALLBACK:', process.env.ALLOW_MEMORY_DB_FALLBACK);

  try {
    const conn = await mongoose
      .createConnection(uri, {
        dbName,
        serverSelectionTimeoutMS: 15000,
      })
      .asPromise();

    console.log('\n✅ Connected to MongoDB Atlas');
    console.log('   host:', conn.host);
    console.log('   database:', conn.db.databaseName);

    const users = conn.db.collection('users');
    const sellers = conn.db.collection('sellers');

    const userCount = await users.countDocuments();
    const sellerCount = await sellers.countDocuments();
    console.log('\nCollection counts:');
    console.log('   users:', userCount);
    console.log('   sellers:', sellerCount);

    const sampleUsers = await users
      .find({}, { projection: { email: 1, role: 1, status: 1, password: 1 } })
      .limit(5)
      .toArray();
    console.log('\nSample users (first 5):');
    for (const u of sampleUsers) {
      const pwd = u.password;
      const pwdType =
        typeof pwd === 'string'
          ? pwd.startsWith('$2')
            ? 'bcrypt'
            : 'plain-text'
          : 'missing';
      console.log(`   - ${u.email} role=${u.role} status=${u.status ?? 'n/a'} password=${pwdType}`);
    }

    const sampleSellers = await sellers
      .find(
        {},
        {
          projection: {
            email: 1,
            onboardingStatus: 1,
            password: 1,
          },
        },
      )
      .limit(5)
      .toArray();
    console.log('\nSample sellers (first 5):');
    for (const s of sampleSellers) {
      const pwd = s.password;
      const pwdType =
        typeof pwd === 'string'
          ? pwd.startsWith('$2')
            ? 'bcrypt'
            : pwd.length > 0
              ? 'plain-text'
              : 'empty'
          : 'missing';
      console.log(
        `   - ${s.email} onboarding=${s.onboardingStatus ?? 'n/a'} password=${pwdType}`,
      );
    }

    await conn.close();
    process.exit(0);
  } catch (err) {
    const message = err.message || String(err);
    console.error('\n❌ MongoDB connection failed');
    console.error(message);
    if (/querySrv\s+ECONNREFUSED/i.test(message)) {
      console.error(
        '\nNode.js cannot resolve mongodb+srv on this machine (DNS SRV blocked).',
      );
      console.error(
        'Use the standard mongodb:// connection string from Atlas (Connect → Drivers),',
      );
      console.error(
        'not mongodb+srv:// — see .env.development MONGODB_URI for an example.',
      );
    }
    console.error(
      '\nIf password contains @, URL-encode it as %40 (Ecomm@2020 → Ecomm%402020).',
    );
    process.exit(1);
  }
}

main();

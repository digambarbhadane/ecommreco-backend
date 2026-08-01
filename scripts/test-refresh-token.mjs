import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';

const uri = process.env.MONGODB_URI;
const secret = process.env.JWT_SECRET;
if (!uri || !secret) {
  console.error('Set MONGODB_URI and JWT_SECRET');
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;

const securities = await db
  .collection('user_security')
  .find({ refreshTokens: { $exists: true, $ne: [] } })
  .limit(5)
  .toArray();

console.log('user_security with refresh tokens:', securities.length);

for (const sec of securities.slice(0, 3)) {
  const rt = sec.refreshTokens?.[sec.refreshTokens.length - 1];
  const sessions = sec.activeSessions ?? [];
  console.log('\nuserId:', sec.userId);
  console.log('activeSessions:', sessions.length, 'last:', sessions[sessions.length - 1]?.sessionId);
  console.log('refreshTokens:', sec.refreshTokens?.length, 'last jti:', rt?.jti);
  console.log('session match:', sessions.some((s) => s.sessionId === rt?.sessionId));
}

// Try refresh API if we can reconstruct a token from stored hash - we cannot without full token

await mongoose.disconnect();

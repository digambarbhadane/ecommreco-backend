require('dotenv').config({ path: '.env.development' });
const mongoose = require('mongoose');
const crypto = require('crypto');

const generatePublicId = (type, extraInfo = '') => {
  const prefix = type === 'seller' ? 'SEL' : 'USR';
  const d = new Date();
  const yyyymm = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const code = crypto
    .randomInt(0, 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0')
    .slice(-4);
  return `${prefix}-${yyyymm}-${code}`;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB_NAME,
  });
  const col = mongoose.connection.db.collection('sellers');
  const missing = await col
    .find({
      $or: [{ publicId: { $exists: false } }, { publicId: null }, { publicId: '' }],
    })
    .toArray();

  for (const seller of missing) {
    const email = seller.email || seller.username || String(seller._id);
    const publicId = generatePublicId('seller', email);
    await col.updateOne({ _id: seller._id }, { $set: { publicId } });
    console.log(`Backfilled publicId for ${email}: ${publicId}`);
  }

  console.log(`Backfilled ${missing.length} seller(s)`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

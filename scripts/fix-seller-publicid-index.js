/**
 * Recreates sellers.publicId as a sparse unique index so multiple documents
 * without publicId are not blocked (legacy data). Safe to run multiple times.
 */
require('dotenv').config({ path: '.env.development' });
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB_NAME,
  });
  const col = mongoose.connection.db.collection('sellers');
  const indexes = await col.indexes();
  const publicIdIndex = indexes.find((idx) => {
    const key = idx.key ?? {};
    return Object.keys(key).length === 1 && key.publicId === 1;
  });

  if (publicIdIndex && !publicIdIndex.sparse) {
    console.log(`Dropping non-sparse publicId index: ${publicIdIndex.name}`);
    await col.dropIndex(publicIdIndex.name);
  }

  await col.createIndex(
    { publicId: 1 },
    { unique: true, sparse: true, name: 'publicId_1' },
  );
  console.log('publicId sparse unique index is in place.');

  await mongoose.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

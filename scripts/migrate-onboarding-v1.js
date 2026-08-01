/**
 * Migrates legacy trial sellers (pending_payment) into onboarding v2 lead + user records.
 *
 * Usage:
 *   node scripts/migrate-onboarding-v1.js [--dry-run]
 */
require('dotenv').config({ path: '.env.development' });
const mongoose = require('mongoose');
const crypto = require('crypto');

const dryRun = process.argv.includes('--dry-run');

const generatePublicId = (type) => {
  const prefix = type === 'lead' ? 'LED' : type === 'seller' ? 'SEL' : 'USR';
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

  const db = mongoose.connection.db;
  const sellers = db.collection('sellers');
  const users = db.collection('users');
  const leads = db.collection('leads');

  const pending = await sellers
    .find({
      isTrial: true,
      trialStatus: 'pending_payment',
    })
    .toArray();

  console.log(`Found ${pending.length} legacy pending-payment trial seller(s)`);

  for (const seller of pending) {
    const email = String(seller.email ?? '').trim().toLowerCase();
    if (!email) {
      console.warn(`Skipping seller ${seller._id}: missing email`);
      continue;
    }

    const existingUser = await users.findOne({ email });
    if (existingUser?.onboardingUserStatus === 'ACTIVE') {
      console.log(`Skip ${email}: user already active in onboarding v2`);
      continue;
    }

    const leadNumber = generatePublicId('lead');
    const leadDoc = {
      publicId: leadNumber,
      leadId: leadNumber,
      leadNumber,
      fullName: seller.fullName ?? seller.ownerName ?? email,
      firmName: seller.firmName ?? seller.companyName ?? '',
      contactNumber: seller.contactNumber ?? '',
      email,
      gstNumber: seller.gstNumber ?? '',
      panNumber: seller.panNumber ?? '',
      sellerId: String(seller._id),
      onboardingStatus: 'PAYMENT_PENDING',
      pipelineStage: 'Payment Pending',
      leadStatus: 'interested',
      status: 'FOLLOW_UP',
      source: seller.leadSource ?? 'legacy_trial_migration',
      metadata: { migratedFrom: 'seller_v1', sellerId: String(seller._id) },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (dryRun) {
      console.log(`[dry-run] Would migrate seller ${email}`);
      continue;
    }

    const leadResult = await leads.insertOne(leadDoc);
    const leadId = leadResult.insertedId;

    if (existingUser) {
      await users.updateOne(
        { _id: existingUser._id },
        {
          $set: {
            leadId,
            sellerId: seller._id,
            onboardingUserStatus: 'PENDING_PAYMENT',
            status: 'pending',
            updatedAt: new Date(),
          },
        },
      );
      await leads.updateOne({ _id: leadId }, { $set: { userId: existingUser._id } });
      console.log(`Linked existing user for ${email}`);
      continue;
    }

    const userResult = await users.insertOne({
      publicId: generatePublicId('seller'),
      fullName: leadDoc.fullName,
      companyName: leadDoc.firmName,
      email,
      mobile: leadDoc.contactNumber,
      username: email,
      password: seller.password ?? '',
      role: 'seller',
      status: 'pending',
      profileCompleted: false,
      leadId,
      sellerId: seller._id,
      onboardingUserStatus: 'PENDING_PAYMENT',
      isEmailVerified: false,
      registrationSource: 'legacy_trial_migration',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await leads.updateOne({ _id: leadId }, { $set: { userId: userResult.insertedId } });
    console.log(`Migrated seller ${email} → lead ${leadNumber}`);
  }

  await mongoose.disconnect();
  console.log(dryRun ? 'Dry run complete' : 'Migration complete');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

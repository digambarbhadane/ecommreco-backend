import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Set MONGODB_URI');
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;
const now = new Date();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
const paidSellerStatuses = ['paid', 'payment_completed'];

const activeSellerSubscriptionFilter = {
  subscriptionEndsAt: { $gt: now },
  $or: [
    { paymentStatus: { $in: paidSellerStatuses } },
    { trialStatus: { $in: ['active', 'converted'] } },
  ],
};

const [
  orderTotal,
  paidCount,
  pendingCount,
  totalRevenue,
  activeSubs,
  trialUsers,
  pendingTrial,
  trialRevenue,
  recentCount,
] = await Promise.all([
  db.collection('payment_orders').countDocuments(),
  db.collection('payment_orders').countDocuments({ paymentStatus: 'paid' }),
  db.collection('payment_orders').countDocuments({ paymentStatus: 'pending' }),
  db
    .collection('payment_orders')
    .aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ])
    .toArray(),
  db.collection('sellers').countDocuments(activeSellerSubscriptionFilter),
  db.collection('sellers').countDocuments({
    isTrial: true,
    trialStatus: 'active',
    subscriptionEndsAt: { $gt: now },
  }),
  db.collection('sellers').countDocuments({
    isTrial: true,
    trialStatus: 'pending_payment',
  }),
  db
    .collection('payment_orders')
    .aggregate([
      {
        $match: {
          paymentStatus: 'paid',
          'metadata.checkoutType': {
            $in: ['trial_registration', 'trial_upgrade', 'onboarding_trial'],
          },
        },
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ])
    .toArray(),
  db.collection('payment_orders').countDocuments(),
]);

console.log(
  JSON.stringify(
    {
      orderTotal,
      paidCount,
      pendingCount,
      totalRevenue: totalRevenue[0]?.total ?? 0,
      activeSubscriptions: activeSubs,
      trialUsers,
      pendingTrialPayments: pendingTrial,
      trialRevenue: trialRevenue[0]?.total ?? 0,
      recentPaymentsCount: Math.min(recentCount, 25),
      monthlyRevenueNote: 'Same as total when all paid in current month',
      monthStart: monthStart.toISOString(),
    },
    null,
    2,
  ),
);

await mongoose.disconnect();

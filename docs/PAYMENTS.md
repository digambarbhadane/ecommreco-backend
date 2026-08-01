# Cashfree Payment Gateway & Subscription Module

Enterprise-grade Cashfree integration for EcommReco SaaS billing.

## Architecture

```
payments/
├── gateways/
│   ├── payment-gateway.interface.ts   # Gateway abstraction (extensible)
│   └── cashfree.gateway.ts            # Cashfree PG implementation
├── schemas/
│   ├── payment-order.schema.ts
│   ├── payment-transaction.schema.ts
│   ├── seller-subscription.schema.ts
│   ├── payment-invoice.schema.ts
│   ├── payment-log.schema.ts
│   └── coupon.schema.ts
├── payments.service.ts                # Core payment & subscription APIs
├── payment-activation.service.ts      # Post-payment seller activation
├── payment-webhook.service.ts         # Webhook verification & idempotency
├── payment-invoice.service.ts         # PDF invoice generation
├── payment-pricing.service.ts         # Server-side amount calculation
├── payment-log.service.ts             # Audit logs
└── renewal-reminder.scheduler.ts      # Expiry reminder cron
```

## Environment Variables

### Backend

```env
CASHFREE_CLIENT_ID=
CASHFREE_CLIENT_SECRET=
CASHFREE_ENVIRONMENT=sandbox          # sandbox | production
CASHFREE_WEBHOOK_SECRET=
CASHFREE_BASE_URL=                    # optional override
API_PUBLIC_URL=                       # for invoice download URLs
INVOICE_STORAGE_PATH=                 # default: storage/invoices
COMPANY_NAME=EcommReco
COMPANY_GSTIN=
COMPANY_ADDRESS=
```

### Frontend

```env
VITE_CASHFREE_ENVIRONMENT=sandbox     # sandbox | production
```

## API Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/subscription/plans` | Public | List active plans |
| POST | `/payments/create-order` | Seller | Create Cashfree order |
| POST | `/payments/verify` | Seller | Verify payment |
| GET | `/payments/history` | Seller | Payment history |
| GET | `/subscription/current` | Seller | Current subscription |
| POST | `/subscription/renew` | Seller | Renew subscription |
| POST | `/subscription/cancel` | Seller | Cancel subscription |
| POST | `/payments/refund` | Admin | Initiate refund |
| GET | `/payments/admin/dashboard` | Admin | Revenue metrics |
| GET | `/payments/invoices/:id/download` | Seller | Download PDF invoice |
| POST | `/webhooks/cashfree` | Public | Cashfree webhooks |

## Payment Flow

1. Seller selects plan → `POST /payments/create-order`
2. Backend calculates amount, creates `payment_orders` record, calls Cashfree
3. Frontend opens Cashfree Checkout with `payment_session_id`
4. On success → redirect to `/payment/success?order_id=...`
5. Frontend calls `POST /payments/verify` (never trusts client alone)
6. Webhook also processes `PAYMENT_SUCCESS` with signature verification
7. Subscription activated, invoice PDF generated, email sent

## Security

- Secret keys only on backend
- All amounts calculated server-side
- Webhook signature verification (HMAC SHA256)
- Idempotency keys for order creation
- Duplicate webhook protection

## Adding Another Gateway

1. Implement `PaymentGateway` interface in `gateways/`
2. Register provider in `payments.module.ts`
3. Set `paymentGateway` field on orders

## Database Collections

- `payment_orders` — order records
- `payment_transactions` — gateway transactions
- `seller_subscriptions` — active seller subscriptions
- `invoices` — generated tax invoices
- `payment_logs` — audit trail
- `coupons` — future coupon support

## Tests

```bash
npm test -- tests/unit/payments
```

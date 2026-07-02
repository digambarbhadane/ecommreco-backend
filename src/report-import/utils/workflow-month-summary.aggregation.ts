import type { PipelineStage } from 'mongoose';

const num = (field: string) => ({ $ifNull: [`$${field}`, 0] });

const docTypeUpper = { $toUpper: { $ifNull: ['$documentType', ''] } };
const isSalesDoc = {
  $regexMatch: { input: docTypeUpper, regex: 'SALE' },
};
const isReturnDoc = {
  $or: [
    { $regexMatch: { input: docTypeUpper, regex: 'RETURN' } },
    { $regexMatch: { input: docTypeUpper, regex: 'RTO' } },
  ],
};
const isCancelledDoc = {
  $regexMatch: { input: docTypeUpper, regex: 'CANCEL' },
};

const invoiceAmt = num('invoiceAmount');
const taxableAmt = num('taxableAmount');
const igstAmt = num('igstAmount');
const cgstAmt = num('cgstAmount');
const sgstAmt = num('sgstAmount');
const qty = num('quantity');

export const PAYMENT_AMOUNT_FIELDS = [
  { key: 'finalSettlementAmount', label: 'Final settlement' },
  { key: 'totalSaleAmountInclShippingGst', label: 'Total sale (incl. shipping & GST)' },
  {
    key: 'totalSaleReturnAmountInclShippingGst',
    label: 'Total sale return (incl. shipping & GST)',
  },
  { key: 'meeshoCommissionInclGst', label: 'Marketplace commission (incl. GST)' },
  { key: 'meeshoGoldPlatformFeeInclGst', label: 'Gold platform fee (incl. GST)' },
  { key: 'meeshoMallPlatformFeeInclGst', label: 'Mall platform fee (incl. GST)' },
  { key: 'fixedFeeInclGst', label: 'Fixed fee (incl. GST)' },
  { key: 'warehousingFeeInclGst', label: 'Warehousing fee (incl. GST)' },
  { key: 'shippingChargeInclGst', label: 'Shipping charge (incl. GST)' },
  { key: 'returnShippingChargeInclGst', label: 'Return shipping (incl. GST)' },
  { key: 'returnPremiumInclGst', label: 'Return premium (incl. GST)' },
  { key: 'paymentTcs', label: 'TCS on payment' },
  { key: 'tds', label: 'TDS' },
  { key: 'compensation', label: 'Compensation' },
  { key: 'claims', label: 'Claims' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'otherSupportServiceChargesExclGst', label: 'Other support charges (excl. GST)' },
  { key: 'waiversExclGst', label: 'Waivers (excl. GST)' },
] as const;

function sumField(field: string) {
  return { $sum: num(field) };
}

export function buildWorkflowMonthSummaryPipeline(
  rowFilter: Record<string, unknown>,
): PipelineStage[] {
  const paymentGroupFields = Object.fromEntries(
    PAYMENT_AMOUNT_FIELDS.map(({ key }) => [key, sumField(key)]),
  );

  return [
    { $match: rowFilter },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalRows: { $sum: 1 },
              salesRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'sales'] }, 1, 0] },
              },
              cashbackRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'cashback'] }, 1, 0] },
              },
              salesDocRows: { $sum: { $cond: [isSalesDoc, 1, 0] } },
              returnsDocRows: { $sum: { $cond: [isReturnDoc, 1, 0] } },
              cancelledDocRows: { $sum: { $cond: [isCancelledDoc, 1, 0] } },
              totalInvoiceAmount: { $sum: invoiceAmt },
              salesInvoiceAmount: {
                $sum: { $cond: [isSalesDoc, invoiceAmt, 0] },
              },
              returnsInvoiceAmount: {
                $sum: { $cond: [isReturnDoc, invoiceAmt, 0] },
              },
              salesPcs: {
                $sum: { $cond: [isSalesDoc, qty, 0] },
              },
              returnsPcs: {
                $sum: { $cond: [isReturnDoc, qty, 0] },
              },
              salesTaxableAmount: {
                $sum: { $cond: [isSalesDoc, taxableAmt, 0] },
              },
              returnsTaxableAmount: {
                $sum: { $cond: [isReturnDoc, taxableAmt, 0] },
              },
              salesIgst: {
                $sum: { $cond: [isSalesDoc, igstAmt, 0] },
              },
              returnsIgst: {
                $sum: { $cond: [isReturnDoc, igstAmt, 0] },
              },
              salesCgst: {
                $sum: { $cond: [isSalesDoc, cgstAmt, 0] },
              },
              returnsCgst: {
                $sum: { $cond: [isReturnDoc, cgstAmt, 0] },
              },
              salesSgst: {
                $sum: { $cond: [isSalesDoc, sgstAmt, 0] },
              },
              returnsSgst: {
                $sum: { $cond: [isReturnDoc, sgstAmt, 0] },
              },
              cancelledInvoiceAmount: {
                $sum: { $cond: [isCancelledDoc, invoiceAmt, 0] },
              },
              totalTaxableAmount: { $sum: taxableAmt },
              totalIgst: { $sum: igstAmt },
              totalCgst: { $sum: cgstAmt },
              totalSgst: { $sum: sgstAmt },
              minInvoiceDate: { $min: '$invoiceDate' },
              maxInvoiceDate: { $max: '$invoiceDate' },
              ordersWithSettlement: {
                $sum: {
                  $cond: [{ $gt: [num('finalSettlementAmount'), 0] }, 1, 0],
                },
              },
              ...paymentGroupFields,
            },
          },
        ],
        byDocumentType: [
          {
            $group: {
              _id: { $ifNull: ['$documentType', 'Unknown'] },
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 30 },
        ],
        byReportType: [
          {
            $group: {
              _id: '$reportType',
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1 } },
        ],
      },
    },
  ];
}

export type WorkflowMonthTotalsRow = {
  totalRows?: number;
  salesRows?: number;
  cashbackRows?: number;
  salesDocRows?: number;
  returnsDocRows?: number;
  cancelledDocRows?: number;
  totalInvoiceAmount?: number;
  salesInvoiceAmount?: number;
  returnsInvoiceAmount?: number;
  salesPcs?: number;
  returnsPcs?: number;
  salesTaxableAmount?: number;
  returnsTaxableAmount?: number;
  salesIgst?: number;
  returnsIgst?: number;
  salesCgst?: number;
  returnsCgst?: number;
  salesSgst?: number;
  returnsSgst?: number;
  cancelledInvoiceAmount?: number;
  totalTaxableAmount?: number;
  totalIgst?: number;
  totalCgst?: number;
  totalSgst?: number;
  minInvoiceDate?: string;
  maxInvoiceDate?: string;
  ordersWithSettlement?: number;
} & Partial<Record<(typeof PAYMENT_AMOUNT_FIELDS)[number]['key'], number>>;

export type MeeshoMonthTotalsRow = WorkflowMonthTotalsRow & {
  meeshoGrossSalesRows?: number;
  meeshoTcsReturnRows?: number;
  meeshoReturnCancellationRows?: number;
  meeshoReturnRtoRows?: number;
  meeshoReturnCustomerRows?: number;
  meeshoGrossSalesPcs?: number;
  meeshoTcsReturnPcs?: number;
  meeshoReturnCancellationPcs?: number;
  meeshoReturnRtoPcs?: number;
  meeshoReturnCustomerPcs?: number;
  meeshoGrossSalesTaxable?: number;
  meeshoTcsReturnTaxable?: number;
  meeshoReturnCancellationTaxable?: number;
  meeshoReturnRtoTaxable?: number;
  meeshoReturnCustomerTaxable?: number;
  meeshoGrossSalesIgst?: number;
  meeshoTcsReturnIgst?: number;
  meeshoReturnCancellationIgst?: number;
  meeshoReturnRtoIgst?: number;
  meeshoReturnCustomerIgst?: number;
  meeshoGrossSalesCgst?: number;
  meeshoTcsReturnCgst?: number;
  meeshoReturnCancellationCgst?: number;
  meeshoReturnRtoCgst?: number;
  meeshoReturnCustomerCgst?: number;
  meeshoGrossSalesSgst?: number;
  meeshoTcsReturnSgst?: number;
  meeshoReturnCancellationSgst?: number;
  meeshoReturnRtoSgst?: number;
  meeshoReturnCustomerSgst?: number;
  meeshoGrossSalesInvoice?: number;
  meeshoTcsReturnInvoice?: number;
  meeshoReturnCancellationInvoice?: number;
  meeshoReturnRtoInvoice?: number;
  meeshoReturnCustomerInvoice?: number;
};

export function buildMeeshoWorkflowMonthSummaryPipeline(
  rowFilter: Record<string, unknown>,
): PipelineStage[] {
  const meeshoReturnQty = {
    $ifNull: ['$returnQty', { $ifNull: ['$quantity', 0] }],
  };

  const paymentGroupFields = Object.fromEntries(
    PAYMENT_AMOUNT_FIELDS.map(({ key }) => [key, sumField(key)]),
  );

  const sumWhen = (flag: string, fieldExpr: Record<string, unknown> | number) => ({
    $sum: { $cond: [{ $eq: [`$${flag}`, true] }, fieldExpr, 0] },
  });

  const sumWhenReturnSubType = (
    subType: string,
    fieldExpr: Record<string, unknown> | number,
  ) => ({
    $sum: {
      $cond: [
        {
          $and: [
            { $eq: ['$meeshoHasTcsReturn', true] },
            { $eq: ['$meeshoReturnSubType', subType] },
          ],
        },
        fieldExpr,
        0,
      ],
    },
  });

  return [
    { $match: rowFilter },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalRows: { $sum: 1 },
              salesRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'sales'] }, 1, 0] },
              },
              cashbackRows: {
                $sum: { $cond: [{ $eq: ['$reportType', 'cashback'] }, 1, 0] },
              },
              meeshoGrossSalesRows: sumWhen('meeshoIsGrossSale', 1),
              meeshoTcsReturnRows: sumWhen('meeshoHasTcsReturn', 1),
              meeshoReturnCancellationRows: sumWhenReturnSubType('cancellation', 1),
              meeshoReturnRtoRows: sumWhenReturnSubType('rto', 1),
              meeshoReturnCustomerRows: sumWhenReturnSubType('customer_return', 1),
              meeshoGrossSalesPcs: sumWhen('meeshoIsGrossSale', qty),
              meeshoTcsReturnPcs: sumWhen('meeshoHasTcsReturn', meeshoReturnQty),
              meeshoReturnCancellationPcs: sumWhenReturnSubType(
                'cancellation',
                meeshoReturnQty,
              ),
              meeshoReturnRtoPcs: sumWhenReturnSubType('rto', meeshoReturnQty),
              meeshoReturnCustomerPcs: sumWhenReturnSubType(
                'customer_return',
                meeshoReturnQty,
              ),
              meeshoGrossSalesTaxable: sumWhen('meeshoIsGrossSale', taxableAmt),
              meeshoTcsReturnTaxable: sumWhen('meeshoHasTcsReturn', taxableAmt),
              meeshoReturnCancellationTaxable: sumWhenReturnSubType(
                'cancellation',
                taxableAmt,
              ),
              meeshoReturnRtoTaxable: sumWhenReturnSubType('rto', taxableAmt),
              meeshoReturnCustomerTaxable: sumWhenReturnSubType(
                'customer_return',
                taxableAmt,
              ),
              meeshoGrossSalesIgst: sumWhen('meeshoIsGrossSale', igstAmt),
              meeshoTcsReturnIgst: sumWhen('meeshoHasTcsReturn', igstAmt),
              meeshoReturnCancellationIgst: sumWhenReturnSubType(
                'cancellation',
                igstAmt,
              ),
              meeshoReturnRtoIgst: sumWhenReturnSubType('rto', igstAmt),
              meeshoReturnCustomerIgst: sumWhenReturnSubType(
                'customer_return',
                igstAmt,
              ),
              meeshoGrossSalesCgst: sumWhen('meeshoIsGrossSale', cgstAmt),
              meeshoTcsReturnCgst: sumWhen('meeshoHasTcsReturn', cgstAmt),
              meeshoReturnCancellationCgst: sumWhenReturnSubType(
                'cancellation',
                cgstAmt,
              ),
              meeshoReturnRtoCgst: sumWhenReturnSubType('rto', cgstAmt),
              meeshoReturnCustomerCgst: sumWhenReturnSubType(
                'customer_return',
                cgstAmt,
              ),
              meeshoGrossSalesSgst: sumWhen('meeshoIsGrossSale', sgstAmt),
              meeshoTcsReturnSgst: sumWhen('meeshoHasTcsReturn', sgstAmt),
              meeshoReturnCancellationSgst: sumWhenReturnSubType(
                'cancellation',
                sgstAmt,
              ),
              meeshoReturnRtoSgst: sumWhenReturnSubType('rto', sgstAmt),
              meeshoReturnCustomerSgst: sumWhenReturnSubType(
                'customer_return',
                sgstAmt,
              ),
              meeshoGrossSalesInvoice: sumWhen('meeshoIsGrossSale', invoiceAmt),
              meeshoTcsReturnInvoice: sumWhen('meeshoHasTcsReturn', invoiceAmt),
              meeshoReturnCancellationInvoice: sumWhenReturnSubType(
                'cancellation',
                invoiceAmt,
              ),
              meeshoReturnRtoInvoice: sumWhenReturnSubType('rto', invoiceAmt),
              meeshoReturnCustomerInvoice: sumWhenReturnSubType(
                'customer_return',
                invoiceAmt,
              ),
              totalInvoiceAmount: { $sum: invoiceAmt },
              totalTaxableAmount: { $sum: taxableAmt },
              totalIgst: { $sum: igstAmt },
              totalCgst: { $sum: cgstAmt },
              totalSgst: { $sum: sgstAmt },
              minInvoiceDate: { $min: '$invoiceDate' },
              maxInvoiceDate: { $max: '$invoiceDate' },
              ordersWithSettlement: {
                $sum: {
                  $cond: [{ $gt: [num('finalSettlementAmount'), 0] }, 1, 0],
                },
              },
              ...paymentGroupFields,
            },
          },
        ],
        byDocumentType: [
          {
            $group: {
              _id: { $ifNull: ['$documentType', 'Unknown'] },
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: 30 },
        ],
        byReportType: [
          {
            $group: {
              _id: '$reportType',
              count: { $sum: 1 },
              invoiceAmount: { $sum: invoiceAmt },
              taxableAmount: { $sum: taxableAmt },
            },
          },
          { $sort: { count: -1 } },
        ],
      },
    },
  ];
}

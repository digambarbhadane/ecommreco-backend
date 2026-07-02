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
const isIntraTxn = { $eq: ['$gstTransactionType', 'intra'] };
const isInterTxn = { $eq: ['$gstTransactionType', 'inter'] };
const igstForSummary = {
  $cond: [isIntraTxn, 0, igstAmt],
};
const cgstForSummary = {
  $cond: [isInterTxn, 0, cgstAmt],
};
const sgstForSummary = {
  $cond: [isInterTxn, 0, sgstAmt],
};

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
                $sum: { $cond: [isSalesDoc, igstForSummary, 0] },
              },
              returnsIgst: {
                $sum: { $cond: [isReturnDoc, igstForSummary, 0] },
              },
              salesCgst: {
                $sum: { $cond: [isSalesDoc, cgstForSummary, 0] },
              },
              returnsCgst: {
                $sum: { $cond: [isReturnDoc, cgstForSummary, 0] },
              },
              salesSgst: {
                $sum: { $cond: [isSalesDoc, sgstForSummary, 0] },
              },
              returnsSgst: {
                $sum: { $cond: [isReturnDoc, sgstForSummary, 0] },
              },
              cancelledInvoiceAmount: {
                $sum: { $cond: [isCancelledDoc, invoiceAmt, 0] },
              },
              totalTaxableAmount: { $sum: taxableAmt },
              totalIgst: { $sum: igstForSummary },
              totalCgst: { $sum: cgstForSummary },
              totalSgst: { $sum: sgstForSummary },
              intraStateSalesRows: {
                $sum: { $cond: [{ $and: [isSalesDoc, isIntraTxn] }, 1, 0] },
              },
              interStateSalesRows: {
                $sum: { $cond: [{ $and: [isSalesDoc, isInterTxn] }, 1, 0] },
              },
              intraStateTaxableAmount: {
                $sum: { $cond: [isIntraTxn, taxableAmt, 0] },
              },
              interStateTaxableAmount: {
                $sum: { $cond: [isInterTxn, taxableAmt, 0] },
              },
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
  intraStateSalesRows?: number;
  interStateSalesRows?: number;
  intraStateTaxableAmount?: number;
  interStateTaxableAmount?: number;
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
  meeshoReturnNaRows?: number;
  meeshoGrossSalesPcs?: number;
  meeshoTcsReturnPcs?: number;
  meeshoReturnCancellationPcs?: number;
  meeshoReturnRtoPcs?: number;
  meeshoReturnCustomerPcs?: number;
  meeshoReturnNaPcs?: number;
  meeshoGrossSalesTaxable?: number;
  meeshoTcsReturnTaxable?: number;
  meeshoReturnCancellationTaxable?: number;
  meeshoReturnRtoTaxable?: number;
  meeshoReturnCustomerTaxable?: number;
  meeshoReturnNaTaxable?: number;
  meeshoGrossSalesIgst?: number;
  meeshoTcsReturnIgst?: number;
  meeshoReturnCancellationIgst?: number;
  meeshoReturnRtoIgst?: number;
  meeshoReturnCustomerIgst?: number;
  meeshoReturnNaIgst?: number;
  meeshoGrossSalesCgst?: number;
  meeshoTcsReturnCgst?: number;
  meeshoReturnCancellationCgst?: number;
  meeshoReturnRtoCgst?: number;
  meeshoReturnCustomerCgst?: number;
  meeshoReturnNaCgst?: number;
  meeshoGrossSalesSgst?: number;
  meeshoTcsReturnSgst?: number;
  meeshoReturnCancellationSgst?: number;
  meeshoReturnRtoSgst?: number;
  meeshoReturnCustomerSgst?: number;
  meeshoReturnNaSgst?: number;
  meeshoGrossSalesInvoice?: number;
  meeshoTcsReturnInvoice?: number;
  meeshoReturnCancellationInvoice?: number;
  meeshoReturnRtoInvoice?: number;
  meeshoReturnCustomerInvoice?: number;
  meeshoReturnNaInvoice?: number;
};

export function buildMeeshoWorkflowMonthSummaryPipeline(
  rowFilter: Record<string, unknown>,
): PipelineStage[] {
  const meeshoReturnQtyForSummary = {
    $ifNull: ['$returnQty', { $ifNull: ['$quantity', 0] }],
  };

  const paymentGroupFields = Object.fromEntries(
    PAYMENT_AMOUNT_FIELDS.map(({ key }) => [key, sumField(key)]),
  );

  const sumWhen = (flag: string, fieldExpr: Record<string, unknown> | number) => ({
    $sum: { $cond: [{ $eq: [`$${flag}`, true] }, fieldExpr, 0] },
  });

  /** TCS Sales Return documents only — matches Excel pivot on the return file. */
  const isMeeshoReturnRow = { $eq: ['$meeshoIsGrossSale', false] };

  const sumWhenMeeshoReturnRow = (fieldExpr: Record<string, unknown> | number) => ({
    $sum: { $cond: [isMeeshoReturnRow, fieldExpr, 0] },
  });

  const sumWhenTcsReturnSubType = (
    subType: string,
    fieldExpr: Record<string, unknown> | number,
  ) => ({
    $sum: {
      $cond: [
        {
          $and: [
            isMeeshoReturnRow,
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
              meeshoTcsReturnRows: sumWhenMeeshoReturnRow(1),
              meeshoReturnCancellationRows: sumWhenTcsReturnSubType('cancellation', 1),
              meeshoReturnRtoRows: sumWhenTcsReturnSubType('rto', 1),
              meeshoReturnCustomerRows: sumWhenTcsReturnSubType('customer_return', 1),
              meeshoReturnNaRows: sumWhenTcsReturnSubType('na', 1),
              meeshoGrossSalesPcs: sumWhen('meeshoIsGrossSale', qty),
              meeshoTcsReturnPcs: sumWhenMeeshoReturnRow(meeshoReturnQtyForSummary),
              meeshoReturnCancellationPcs: sumWhenTcsReturnSubType(
                'cancellation',
                meeshoReturnQtyForSummary,
              ),
              meeshoReturnRtoPcs: sumWhenTcsReturnSubType('rto', meeshoReturnQtyForSummary),
              meeshoReturnCustomerPcs: sumWhenTcsReturnSubType(
                'customer_return',
                meeshoReturnQtyForSummary,
              ),
              meeshoReturnNaPcs: sumWhenTcsReturnSubType('na', meeshoReturnQtyForSummary),
              meeshoGrossSalesTaxable: sumWhen('meeshoIsGrossSale', taxableAmt),
              meeshoTcsReturnTaxable: sumWhenMeeshoReturnRow(taxableAmt),
              meeshoReturnCancellationTaxable: sumWhenTcsReturnSubType(
                'cancellation',
                taxableAmt,
              ),
              meeshoReturnRtoTaxable: sumWhenTcsReturnSubType('rto', taxableAmt),
              meeshoReturnCustomerTaxable: sumWhenTcsReturnSubType(
                'customer_return',
                taxableAmt,
              ),
              meeshoReturnNaTaxable: sumWhenTcsReturnSubType('na', taxableAmt),
              meeshoGrossSalesIgst: sumWhen('meeshoIsGrossSale', igstForSummary),
              meeshoTcsReturnIgst: sumWhenMeeshoReturnRow(igstForSummary),
              meeshoReturnCancellationIgst: sumWhenTcsReturnSubType(
                'cancellation',
                igstForSummary,
              ),
              meeshoReturnRtoIgst: sumWhenTcsReturnSubType('rto', igstForSummary),
              meeshoReturnCustomerIgst: sumWhenTcsReturnSubType(
                'customer_return',
                igstForSummary,
              ),
              meeshoReturnNaIgst: sumWhenTcsReturnSubType('na', igstForSummary),
              meeshoGrossSalesCgst: sumWhen('meeshoIsGrossSale', cgstForSummary),
              meeshoTcsReturnCgst: sumWhenMeeshoReturnRow(cgstForSummary),
              meeshoReturnCancellationCgst: sumWhenTcsReturnSubType(
                'cancellation',
                cgstForSummary,
              ),
              meeshoReturnRtoCgst: sumWhenTcsReturnSubType('rto', cgstForSummary),
              meeshoReturnCustomerCgst: sumWhenTcsReturnSubType(
                'customer_return',
                cgstForSummary,
              ),
              meeshoReturnNaCgst: sumWhenTcsReturnSubType('na', cgstForSummary),
              meeshoGrossSalesSgst: sumWhen('meeshoIsGrossSale', sgstForSummary),
              meeshoTcsReturnSgst: sumWhenMeeshoReturnRow(sgstForSummary),
              meeshoReturnCancellationSgst: sumWhenTcsReturnSubType(
                'cancellation',
                sgstForSummary,
              ),
              meeshoReturnRtoSgst: sumWhenTcsReturnSubType('rto', sgstForSummary),
              meeshoReturnCustomerSgst: sumWhenTcsReturnSubType(
                'customer_return',
                sgstForSummary,
              ),
              meeshoReturnNaSgst: sumWhenTcsReturnSubType('na', sgstForSummary),
              meeshoGrossSalesInvoice: sumWhen('meeshoIsGrossSale', invoiceAmt),
              meeshoTcsReturnInvoice: sumWhenMeeshoReturnRow(invoiceAmt),
              meeshoReturnCancellationInvoice: sumWhenTcsReturnSubType(
                'cancellation',
                invoiceAmt,
              ),
              meeshoReturnRtoInvoice: sumWhenTcsReturnSubType('rto', invoiceAmt),
              meeshoReturnCustomerInvoice: sumWhenTcsReturnSubType(
                'customer_return',
                invoiceAmt,
              ),
              meeshoReturnNaInvoice: sumWhenTcsReturnSubType('na', invoiceAmt),
              totalInvoiceAmount: { $sum: invoiceAmt },
              totalTaxableAmount: { $sum: taxableAmt },
              totalIgst: { $sum: igstForSummary },
              totalCgst: { $sum: cgstForSummary },
              totalSgst: { $sum: sgstForSummary },
              intraStateSalesRows: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$meeshoIsGrossSale', true] },
                        { $eq: ['$gstTransactionType', 'intra'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              interStateSalesRows: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$meeshoIsGrossSale', true] },
                        { $eq: ['$gstTransactionType', 'inter'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              intraStateTaxableAmount: {
                $sum: {
                  $cond: [{ $eq: ['$gstTransactionType', 'intra'] }, taxableAmt, 0],
                },
              },
              interStateTaxableAmount: {
                $sum: {
                  $cond: [{ $eq: ['$gstTransactionType', 'inter'] }, taxableAmt, 0],
                },
              },
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

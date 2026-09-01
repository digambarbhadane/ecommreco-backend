import {
  enrichFlipkartOrderDetailsMetadata,
  mapFlipkartNoteImportRowToAnalyticsRow,
  mapFlipkartPaymentToAnalyticsRow,
  selectUncoveredFlipkartGstReturnRows,
  splitFlipkartPaymentInvoiceIds,
} from '../../../src/report-import/payments/payment-analytics.types';
import {
  aggregateOrderPaymentLifecycle,
  isPaymentOverdue,
  isPaymentSettled,
  toOrderPaymentStatusRow,
} from '../../../src/report-import/payments/payment-reconciliation.util';

describe('Flipkart GST Sale import attachment mapping', () => {
  it('maps Flipkart GST Sale import rows with invoiceNo → invoiceId', () => {
    const sale = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'sale-1',
      orderID: 'OD336094697187376100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000983',
      invoiceAmount: 443,
      invoiceDate: '2025-11-26',
      skuID: 'M&M-TTB-Black-2XL',
      quantity: 1,
    });

    expect(sale).not.toBeNull();
    expect(sale!.source).toBe('import_rows');
    expect(sale!.documentType).toBe('Sale');
    expect(sale!.invoiceId).toBe('FATQXW2600000983');
    expect(sale!.saleAmount).toBe(443);
    expect(sale!.refund).toBe(0);
    expect(sale!.bankSettlementValue).toBe(0);
    expect(sale!._id).toBe('fk-sale:sale-1');
  });

  it('passes through Flipkart GST Sale transactionId / NEFT when present on import_rows', () => {
    const sale = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'sale-txn',
      orderID: 'OD334570353625543100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000033',
      invoiceAmount: 199,
      transactionId: 'NFT-/XUTR/DEUTH02516797199X',
    });

    expect(sale).not.toBeNull();
    expect(sale!.neftId).toBe('NFT-/XUTR/DEUTH02516797199X');
    expect(sale!.transactionId).toBe('NFT-/XUTR/DEUTH02516797199X');
  });

  it('does not treat Sales Cancellation as a Sale invoice', () => {
    const cancelled = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'sc-1',
      orderID: 'OD1',
      documentType: 'Sales Cancellation',
      invoiceNo: 'SC-1',
      invoiceAmount: -100,
    });
    expect(cancelled).not.toBeNull();
    expect(cancelled!.documentType).toBe('Sales Cancellation');
    expect(cancelled!._id).toBe('fk-note:sc-1');
    expect(cancelled!.saleAmount).toBe(0);
  });

  it('keeps GST Sales as separate leaf rows alongside payment returns and notes', () => {
    const saleA = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 's1',
      orderID: 'OD336094697187376100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000983',
      invoiceAmount: 443,
      skuID: 'SKU-A',
      quantity: 1,
    })!;
    const saleB = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 's2',
      orderID: 'OD336094697187376100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000983',
      invoiceAmount: 443,
      skuID: 'SKU-B',
      quantity: 1,
    })!;
    const returnNeft = mapFlipkartPaymentToAnalyticsRow({
      _id: 'r1',
      orderId: 'OD336094697187376100',
      returnType: 'Logistics Return',
      saleAmount: 0,
      saleAmountSummary: 886,
      refund: -886,
      bankSettlementValue: 0,
      sellerSku: 'SKU-B',
      marketplace: 'flipkart',
    } as never);
    const credit = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'c1',
      orderID: 'OD336094697187376100',
      documentType: 'Credit Note',
      invoiceNo: 'CN-1',
      invoiceAmount: 30,
    })!;
    const debit = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'd1',
      orderID: 'OD336094697187376100',
      documentType: 'Debit Note',
      invoiceNo: 'DN-1',
      invoiceAmount: -30,
    })!;

    const rows = [saleA, saleB, returnNeft, credit, debit];
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.documentType === 'Sale')).toHaveLength(2);

    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.originalSales).toBe(886);
    expect(lifecycle.creditNotes).toBe(30);
    expect(lifecycle.debitNotes).toBe(-30);
  });

  it('normalizes wrapped Flipkart GST SKU so sales de-dupe with payment returns', () => {
    const sale = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 's-black',
      orderID: 'OD336094697187376100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000983',
      invoiceAmount: 443,
      skuID: '"""SKU:M&M-TTB-Black-2XL"""',
      quantity: 1,
    })!;
    const saleBeige = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 's-beige',
      orderID: 'OD336094697187376100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000983',
      invoiceAmount: 443,
      skuID: '"""SKU:M&M-TTB-Beige-2XL"""',
      quantity: 1,
    })!;
    const returnNeft = mapFlipkartPaymentToAnalyticsRow({
      _id: 'r1',
      orderId: 'OD336094697187376100',
      returnType: 'Logistics Return',
      saleAmount: 0,
      saleAmountSummary: 886,
      refund: -886,
      bankSettlementValue: 0,
      sellerSku: 'M&M-TTB-Black-2XL',
      marketplace: 'flipkart',
    } as never);

    expect(sale.sellerSku).toBe('M&M-TTB-Black-2XL');
    expect(saleBeige.sellerSku).toBe('M&M-TTB-Beige-2XL');

    const lifecycle = aggregateOrderPaymentLifecycle([
      sale,
      saleBeige,
      returnNeft,
    ]);
    expect(lifecycle.originalSales).toBe(886);
  });

  it('does not double-count GST Sale when payment return has a different orderItemId key', () => {
    // Mirrors OD434387569951879100: GST Sale has SKU only; return NEFT has orderItemId.
    const sale = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: '6a72d9d280746fa2614452ad',
      orderID: 'OD434387569951879100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000004',
      invoiceAmount: 199,
      skuID: '"""SKU:MMASPK"""',
      quantity: 1,
    })!;
    const returned = mapFlipkartPaymentToAnalyticsRow({
      _id: '6a7314d78fd972e845aa8a93',
      orderId: 'OD434387569951879100',
      orderItemId: '434387569951879100',
      returnType: 'Logistics Return',
      saleAmount: 0,
      saleAmountSummary: 199,
      refund: -199,
      bankSettlementValue: 0,
      sellerSku: 'MMASPK',
      invoiceId: 'FATQXW2600000004',
      marketplace: 'flipkart',
    } as never);

    expect(sale.sellerSku).toBe('MMASPK');
    const lifecycle = aggregateOrderPaymentLifecycle([sale, returned]);
    expect(lifecycle.originalSales).toBe(199);
    expect(lifecycle.originalReturns).toBe(-199);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.difference).toBe(0);
  });

  it('counts two same-SKU Flipkart line items as two sales (not SKU-collapsed)', () => {
    // Pattern: 2 Sale + 2 Return + 2 CN + 2 DN (same sellerSku, distinct invoices/items).
    const sale1 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 's1',
      orderID: 'OD436474695754463100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600001207',
      invoiceAmount: 492,
      skuID: '"""SKU:MMBSBLXL"""',
    })!;
    const sale2 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 's2',
      orderID: 'OD436474695754463100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600001167',
      invoiceAmount: 492,
      skuID: '"""SKU:MMBSBLXL"""',
    })!;
    const cn1 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'c1',
      orderID: 'OD436474695754463100',
      documentType: 'Credit Note',
      invoiceNo: 'CALEBK2600000746',
      invoiceAmount: 33,
    })!;
    const cn2 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'c2',
      orderID: 'OD436474695754463100',
      documentType: 'Credit Note',
      invoiceNo: 'CALEBK2600000764',
      invoiceAmount: 33,
    })!;
    const dn1 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'd1',
      orderID: 'OD436474695754463100',
      documentType: 'Debit Note',
      invoiceNo: 'DAJ0ER2600000195',
      invoiceAmount: -33,
    })!;
    const dn2 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'd2',
      orderID: 'OD436474695754463100',
      documentType: 'Debit Note',
      invoiceNo: 'DAJ0ER2600000203',
      invoiceAmount: -33,
    })!;
    const ret1 = mapFlipkartPaymentToAnalyticsRow({
      _id: 'r1',
      orderId: 'OD436474695754463100',
      orderItemId: '436474695754463101',
      returnType: 'Logistics Return',
      saleAmountSummary: 492,
      refund: -492,
      bankSettlementValue: 0,
      sellerSku: 'MMBSBLXL',
      invoiceId: 'FATQXW2600001207',
      marketplace: 'flipkart',
      neftId: 'NFT-A',
    } as never);
    const ret2 = mapFlipkartPaymentToAnalyticsRow({
      _id: 'r2',
      orderId: 'OD436474695754463100',
      orderItemId: '436474695754463100',
      returnType: 'Logistics Return',
      saleAmountSummary: 492,
      refund: -492,
      bankSettlementValue: 0,
      sellerSku: 'MMBSBLXL',
      invoiceId: 'FATQXW2600001167',
      marketplace: 'flipkart',
      neftId: 'NFT-B',
    } as never);

    const rows = [sale1, sale2, ret1, ret2, cn1, cn2, dn1, dn2];
    expect(rows).toHaveLength(8);

    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.originalSales).toBe(984);
    expect(lifecycle.creditNotes).toBe(66);
    expect(lifecycle.sales).toBe(1050);
    expect(lifecycle.originalReturns).toBe(-984);
    expect(lifecycle.debitNotes).toBe(-66);
    expect(lifecycle.returns).toBe(-1050);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBe(0);
    expect(lifecycle.difference).toBe(0);

    const statusRow = toOrderPaymentStatusRow(rows);
    expect(isPaymentSettled(statusRow)).toBe(true);
    expect(isPaymentOverdue(statusRow, Date.parse('2026-08-21T12:00:00.000Z'))).toBe(
      false,
    );
  });

  it('restores GST Return invoice on payment return without changing lifecycle totals', () => {
    const sale = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'sale-inv',
      orderID: 'OD434881143561454100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000111',
      invoiceAmount: 249,
      skuID: '"""SKU:M&M-O-TB-RED-2XL"""',
    })!;
    const paymentReturn = mapFlipkartPaymentToAnalyticsRow({
      _id: 'ret-pay',
      orderId: 'OD434881143561454100',
      returnType: 'Logistics Return',
      saleAmountSummary: 249,
      refund: -249,
      bankSettlementValue: 0,
      sellerSku: 'M&M-O-TB-RED-2XL',
      invoiceId: 'FATQXW2600000111',
      neftId: 'NFT-/XUTR/DEUTH025206A08VFX',
      marketplace: 'flipkart',
    } as never);

    const enriched = enrichFlipkartOrderDetailsMetadata(
      [sale, paymentReturn],
      [
        {
          orderId: 'OD434881143561454100',
          sellerSku: 'M&M-O-TB-RED-2XL',
          invoiceId: 'RARG0Z2600000034',
          invoiceDate: '2025-06-01',
        },
      ],
    );

    const enrichedSale = enriched.find((r) => r.documentType === 'Sale')!;
    const enrichedReturn = enriched.find(
      (r) => r.source === 'flipkart_payment_order_reports',
    )!;
    expect(enrichedSale.invoiceId).toBe('FATQXW2600000111');
    expect(enrichedReturn.invoiceId).toBe('RARG0Z2600000034');
    expect(enrichedReturn.neftId).toBe('NFT-/XUTR/DEUTH025206A08VFX');

    const before = aggregateOrderPaymentLifecycle([sale, paymentReturn]);
    const after = aggregateOrderPaymentLifecycle(enriched);
    expect(after.originalSales).toBe(before.originalSales);
    expect(after.originalReturns).toBe(before.originalReturns);
    expect(after.netSales).toBe(before.netSales);
    expect(after.difference).toBe(before.difference);
  });

  it('fills GST Sale NEFT from Flipkart payment sale settlement, not from returns', () => {
    const sale = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'sale-neft',
      orderID: 'OD334570353625543100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000033',
      invoiceAmount: 100,
      skuID: '"""SKU:MMASNB"""',
    })!;
    expect(sale.neftId).toBeUndefined();

    const paymentSale = mapFlipkartPaymentToAnalyticsRow({
      _id: 'pay-sale',
      orderId: 'OD334570353625543100',
      returnType: 'NA',
      saleAmountSummary: 100,
      refund: 0,
      bankSettlementValue: 90,
      sellerSku: 'MMASNB',
      invoiceId: 'FATQXW2600000033',
      neftId: 'NFT-/XUTR/DEUTH02516797199X',
      marketplace: 'flipkart',
    } as never);
    const paymentReturn = mapFlipkartPaymentToAnalyticsRow({
      _id: 'pay-ret',
      orderId: 'OD334570353625543100',
      returnType: 'Logistics Return',
      saleAmountSummary: 100,
      refund: -100,
      bankSettlementValue: 0,
      sellerSku: 'MMASNB',
      invoiceId: 'FATQXW2600000033',
      neftId: 'NFT-/XUTR/RETURN-ONLY',
      marketplace: 'flipkart',
    } as never);

    const enriched = enrichFlipkartOrderDetailsMetadata(
      [sale, paymentSale, paymentReturn],
      [],
    );
    const enrichedSale = enriched.find((r) => r.documentType === 'Sale')!;
    expect(enrichedSale.neftId).toBe('NFT-/XUTR/DEUTH02516797199X');
    expect(enrichedSale.transactionId).toBe('NFT-/XUTR/DEUTH02516797199X');
  });

  it('fills GST Sale NEFT from sale settlement even when Flipkart tags returnType', () => {
    const sale = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'sale-neft-rt',
      orderID: 'OD336143085966257100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600001025',
      invoiceAmount: 443,
      skuID: '"""SKU:M&M-TTB-Beige-L"""',
    })!;
    expect(sale.neftId).toBeUndefined();

    const paymentSale = mapFlipkartPaymentToAnalyticsRow({
      _id: 'pay-sale-rt',
      orderId: 'OD336143085966257100',
      returnType: 'Logistics Return',
      saleAmountSummary: 443,
      refund: 0,
      bankSettlementValue: 0,
      sellerSku: 'M&M-TTB-Beige-L',
      invoiceId: 'NA',
      neftId: 'NFT-/XUTR/DEUTH025346A03Q6X',
      marketplace: 'flipkart',
    } as never);
    const paymentReturn = mapFlipkartPaymentToAnalyticsRow({
      _id: 'pay-ret-rt',
      orderId: 'OD336143085966257100',
      returnType: 'Logistics Return',
      saleAmountSummary: 443,
      refund: -443,
      bankSettlementValue: 0,
      sellerSku: 'M&M-TTB-Beige-L',
      invoiceId: 'NA',
      neftId: 'NFT-/XUTR/DEUTH02534690967X',
      marketplace: 'flipkart',
    } as never);

    const enriched = enrichFlipkartOrderDetailsMetadata(
      [sale, paymentSale, paymentReturn],
      [],
    );
    const enrichedSale = enriched.find((r) => r.documentType === 'Sale')!;
    expect(enrichedSale.neftId).toBe('NFT-/XUTR/DEUTH025346A03Q6X');

    const lifecycle = aggregateOrderPaymentLifecycle(enriched);
    expect(lifecycle.originalSales).toBe(443);
    expect(lifecycle.originalReturns).toBe(-443);
    expect(lifecycle.netSales).toBe(0);
  });

  it('maps Flipkart GST Return import rows with refund outflow', () => {
    const ret = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'ret-1',
      orderID: 'OD-RET-MAP',
      documentType: 'Return',
      invoiceNo: 'RARG0Z2600000254',
      invoiceAmount: -713,
      skuID: '"""SKU:MMTBBGNBXL"""',
      quantity: 1,
    });
    expect(ret).not.toBeNull();
    expect(ret!.documentType).toBe('Return');
    expect(ret!.invoiceId).toBe('RARG0Z2600000254');
    expect(ret!.refund).toBe(-713);
    expect(ret!._id).toBe('fk-return:ret-1');
  });

  it('splits Flipkart payment Sale$Return invoice ids', () => {
    expect(
      splitFlipkartPaymentInvoiceIds('FATQXW2600001023$RARG0Z2600000256'),
    ).toEqual(['FATQXW2600001023', 'RARG0Z2600000256']);
    expect(splitFlipkartPaymentInvoiceIds('NA')).toEqual([]);
  });

  it('attaches uncovered GST Return when payment settles only one Sale$Return pair', () => {
    const sale1 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 's1016',
      orderID: 'OD336134923680424100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600001016',
      invoiceAmount: 713,
      skuID: '"""SKU:MMTBBGNBXL"""',
    })!;
    const sale2 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 's1023',
      orderID: 'OD336134923680424100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600001023',
      invoiceAmount: 713,
      skuID: '"""SKU:MMTBBGNBXL"""',
    })!;
    const gstReturnCancelled = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'r0254',
      orderID: 'OD336134923680424100',
      documentType: 'Return',
      invoiceNo: 'RARG0Z2600000254',
      invoiceAmount: -713,
      skuID: '"""SKU:MMTBBGNBXL"""',
    })!;
    const gstReturnSettled = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'r0256',
      orderID: 'OD336134923680424100',
      documentType: 'Return',
      invoiceNo: 'RARG0Z2600000256',
      invoiceAmount: -713,
      skuID: '"""SKU:MMTBBGNBXL"""',
    })!;
    const paymentReturn = mapFlipkartPaymentToAnalyticsRow({
      _id: 'pay-ret',
      orderId: 'OD336134923680424100',
      orderItemId: '336134923680424100',
      returnType: 'Logistics Return',
      saleAmountSummary: 713,
      refund: -713,
      bankSettlementValue: 0,
      sellerSku: 'MMTBBGNBXL',
      invoiceId: 'FATQXW2600001023$RARG0Z2600000256',
      neftId: 'NFT-/XUTR/DEUTH02534690967X',
      marketplace: 'flipkart',
    } as never);

    // All GST Returns are attached; payment refund is skipped in lifecycle.
    const gstReturns = selectUncoveredFlipkartGstReturnRows(
      [paymentReturn],
      [gstReturnCancelled, gstReturnSettled],
    );
    expect(gstReturns).toHaveLength(2);

    const rows = [sale1, sale2, paymentReturn, ...gstReturns];
    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.originalSales).toBe(1426);
    expect(lifecycle.originalReturns).toBe(-1426);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBe(0);
    expect(lifecycle.difference).toBe(0);

    const statusRow = toOrderPaymentStatusRow(rows);
    expect(isPaymentSettled(statusRow)).toBe(true);
    expect(
      isPaymentOverdue(statusRow, Date.parse('2026-08-21T12:00:00.000Z')),
    ).toBe(false);
  });

  it('does not double-count payment refund when GST Returns cover multi-item rollup', () => {
    const sales = [
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 's1',
        orderID: 'OD336072614755823100',
        documentType: 'Sale',
        invoiceNo: 'FATQXW2600000904',
        invoiceAmount: 498,
        skuID: '"""SKU:MMBSBLXL"""',
      })!,
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 's2',
        orderID: 'OD336072614755823100',
        documentType: 'Sale',
        invoiceNo: 'FATQXW2600000904',
        invoiceAmount: 498,
        skuID: '"""SKU:MMBSBGXL"""',
      })!,
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 's3',
        orderID: 'OD336072614755823100',
        documentType: 'Sale',
        invoiceNo: 'FATQXW2600000940',
        invoiceAmount: 441,
        skuID: '"""SKU:MMMWHPP3P4P5XL"""',
      })!,
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 's4',
        orderID: 'OD336072614755823100',
        documentType: 'Sale',
        invoiceNo: 'FATQXW2600000940',
        invoiceAmount: 480,
        skuID: '"""SKU:MMMWHPP2P2PP1L"""',
      })!,
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 's5',
        orderID: 'OD336072614755823100',
        documentType: 'Sale',
        invoiceNo: 'FATQXW2600000904',
        invoiceAmount: 441,
        skuID: '"""SKU:MMMWHPP3P4P5L"""',
      })!,
    ];
    const gstReturns = [
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 'r1',
        orderID: 'OD336072614755823100',
        documentType: 'Return',
        invoiceNo: 'RARG0Z2600000234',
        invoiceAmount: -480,
        skuID: '"""SKU:MMMWHPP2P2PP1L"""',
      })!,
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 'r2',
        orderID: 'OD336072614755823100',
        documentType: 'Return',
        invoiceNo: 'RARG0Z2600000235',
        invoiceAmount: -498,
        skuID: '"""SKU:MMBSBGXL"""',
      })!,
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 'r3',
        orderID: 'OD336072614755823100',
        documentType: 'Return',
        invoiceNo: 'RARG0Z2600000235',
        invoiceAmount: -498,
        skuID: '"""SKU:MMBSBLXL"""',
      })!,
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 'r4',
        orderID: 'OD336072614755823100',
        documentType: 'Return',
        invoiceNo: 'RARG0Z2600000234',
        invoiceAmount: -441,
        skuID: '"""SKU:MMMWHPP3P4P5XL"""',
      })!,
      mapFlipkartNoteImportRowToAnalyticsRow({
        _id: 'r5',
        orderID: 'OD336072614755823100',
        documentType: 'Return',
        invoiceNo: 'RARG0Z2600000235',
        invoiceAmount: -441,
        skuID: '"""SKU:MMMWHPP3P4P5L"""',
      })!,
    ];
    const cn = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'cn1',
      orderID: 'OD336072614755823100',
      documentType: 'Credit Note',
      invoiceNo: 'CALEBK2600000654',
      invoiceAmount: 153,
    })!;
    const dn = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'dn1',
      orderID: 'OD336072614755823100',
      documentType: 'Debit Note',
      invoiceNo: 'DAJ0ER2600000160',
      invoiceAmount: -153,
    })!;
    const paymentReturn = mapFlipkartPaymentToAnalyticsRow({
      _id: 'pay-rollup',
      orderId: 'OD336072614755823100',
      orderItemId:
        '336072614755823100,336072614755823104,336072614755823103,336072614755823102,336072614755823101',
      returnType: 'Logistics Return',
      saleAmountSummary: 2358,
      refund: -2358,
      bankSettlementValue: 0,
      sellerSku: 'MMMWHPP3P4P5L',
      invoiceId: 'FATQXW2600000904',
      neftId: 'NFT-/XUTR/DEUTH02533963027X',
      marketplace: 'flipkart',
    } as never);

    const attachedReturns = selectUncoveredFlipkartGstReturnRows(
      [paymentReturn],
      gstReturns,
    );
    expect(attachedReturns).toHaveLength(5);

    const rows = [...sales, paymentReturn, ...attachedReturns, cn, dn];
    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.originalSales).toBe(2358);
    expect(lifecycle.creditNotes).toBe(153);
    expect(lifecycle.sales).toBe(2511);
    expect(lifecycle.originalReturns).toBe(-2358);
    expect(lifecycle.debitNotes).toBe(-153);
    expect(lifecycle.returns).toBe(-2511);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.difference).toBe(0);
    expect(isPaymentSettled(toOrderPaymentStatusRow(rows))).toBe(true);
  });

  it('does not attach GST Return when payment return already covers it 1:1', () => {
    const gstReturn = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'r-only',
      orderID: 'OD-COVERED',
      documentType: 'Return',
      invoiceNo: 'RARG0Z2600000034',
      invoiceAmount: -249,
      skuID: '"""SKU:MMASPK"""',
    })!;
    const paymentReturn = mapFlipkartPaymentToAnalyticsRow({
      _id: 'pay-only',
      orderId: 'OD-COVERED',
      returnType: 'Logistics Return',
      saleAmountSummary: 249,
      refund: -249,
      bankSettlementValue: 0,
      sellerSku: 'MMASPK',
      invoiceId: 'FATQXW2600000111',
      marketplace: 'flipkart',
    } as never);

    // GST Return is still attached for display; payment refund is skipped in lifecycle.
    const attached = selectUncoveredFlipkartGstReturnRows(
      [paymentReturn],
      [gstReturn],
    );
    expect(attached).toHaveLength(1);

    const sale = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'sale-only',
      orderID: 'OD-COVERED',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000111',
      invoiceAmount: 249,
      skuID: '"""SKU:MMASPK"""',
    })!;
    const lifecycle = aggregateOrderPaymentLifecycle([
      sale,
      paymentReturn,
      ...attached,
    ]);
    expect(lifecycle.originalSales).toBe(249);
    expect(lifecycle.originalReturns).toBe(-249);
    expect(lifecycle.netSales).toBe(0);
  });

  it('maps positive Flipkart GST Return amount as Return Cancellation (not another return)', () => {
    const rc = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'hkphr-1',
      orderID: 'OD336003030522927100',
      documentType: 'Return',
      invoiceNo: 'HKPHR2600000011',
      invoiceAmount: 749,
      skuID: '"""SKU:M&M-TTS-Black-2XL"""',
    });
    expect(rc).not.toBeNull();
    expect(rc!.documentType).toBe('Return Cancellation');
    expect(rc!.saleAmount).toBe(749);
    expect(rc!.refund).toBe(0);
    expect(rc!._id).toBe('fk-note:hkphr-1');
  });

  it('nets Sale + Return + positive Return (cancellation) + Return to zero', () => {
    const sale = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 's0832',
      orderID: 'OD336003030522927100',
      documentType: 'Sale',
      invoiceNo: 'FATQXW2600000832',
      invoiceAmount: 749,
      skuID: '"""SKU:M&M-TTS-Black-2XL"""',
    })!;
    const ret1 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'r0214',
      orderID: 'OD336003030522927100',
      documentType: 'Return',
      invoiceNo: 'RARG0Z2600000214',
      invoiceAmount: -749,
      skuID: '"""SKU:M&M-TTS-Black-2XL"""',
    })!;
    const returnCancel = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'hkphr',
      orderID: 'OD336003030522927100',
      documentType: 'Return',
      invoiceNo: 'HKPHR2600000011',
      invoiceAmount: 749,
      skuID: '"""SKU:M&M-TTS-Black-2XL"""',
    })!;
    const ret2 = mapFlipkartNoteImportRowToAnalyticsRow({
      _id: 'r0217',
      orderID: 'OD336003030522927100',
      documentType: 'Return',
      invoiceNo: 'RARG0Z2600000217',
      invoiceAmount: -749,
      skuID: '"""SKU:M&M-TTS-Black-2XL"""',
    })!;
    const paymentReturn = mapFlipkartPaymentToAnalyticsRow({
      _id: 'pay',
      orderId: 'OD336003030522927100',
      orderItemId: '336003030522927100',
      returnType: 'Logistics Return',
      saleAmountSummary: 1498,
      refund: -1498,
      bankSettlementValue: 0,
      sellerSku: 'M&M-TTS-Black-2XL',
      invoiceId: 'FATQXW2600000832',
      neftId: 'NFT-/XUTR/DEUTH025330A0EKZX',
      marketplace: 'flipkart',
    } as never);

    expect(returnCancel.documentType).toBe('Return Cancellation');
    expect(ret1.documentType).toBe('Return');
    expect(ret2.refund).toBe(-749);

    const gstReturns = selectUncoveredFlipkartGstReturnRows(
      [paymentReturn],
      [ret1, ret2],
    );
    const rows = [sale, returnCancel, paymentReturn, ...gstReturns];
    const lifecycle = aggregateOrderPaymentLifecycle(rows);
    expect(lifecycle.originalSales).toBe(749);
    expect(lifecycle.returnCancellations).toBe(749);
    expect(lifecycle.sales).toBe(1498);
    expect(lifecycle.originalReturns).toBe(-1498);
    expect(lifecycle.returns).toBe(-1498);
    expect(lifecycle.netSales).toBe(0);
    expect(lifecycle.bankPayout).toBe(0);
    expect(lifecycle.difference).toBe(0);
    expect(isPaymentSettled(toOrderPaymentStatusRow(rows))).toBe(true);
  });

  it('prefers Sale$Return payment invoice token when restoring GST Return invoice', () => {
    const paymentReturn = mapFlipkartPaymentToAnalyticsRow({
      _id: 'pay-dual',
      orderId: 'OD-DUAL-INV',
      returnType: 'Logistics Return',
      saleAmountSummary: 713,
      refund: -713,
      bankSettlementValue: 0,
      sellerSku: 'MMTBBGNBXL',
      invoiceId: 'FATQXW2600001023$RARG0Z2600000256',
      marketplace: 'flipkart',
    } as never);

    const enriched = enrichFlipkartOrderDetailsMetadata(
      [paymentReturn],
      [
        {
          orderId: 'OD-DUAL-INV',
          sellerSku: 'MMTBBGNBXL',
          invoiceId: 'RARG0Z2600000254',
        },
        {
          orderId: 'OD-DUAL-INV',
          sellerSku: 'MMTBBGNBXL',
          invoiceId: 'RARG0Z2600000256',
        },
      ],
    );
    // Already has the settled return invoice in Sale$Return — do not overwrite.
    expect(enriched[0].invoiceId).toBe('FATQXW2600001023$RARG0Z2600000256');
  });
});

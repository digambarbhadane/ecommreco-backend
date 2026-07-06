import {
  buildSellerGstContext,
  calculateGST,
  isIntraStateSupply,
  normalizeState,
} from '../../src/common/services/gst-calculation.core';

describe('GstService calculateGST', () => {
  const gujaratSeller = {
    sellerState: 'Gujarat',
    sellerGstin: '24ABCDE1234F1Z5',
  };

  it('Test 1: Gujarat seller + Gujarat order => CGST 90, SGST 90, IGST 0', () => {
    const result = calculateGST({
      taxableValue: 1000,
      gstRate: 18,
      orderState: 'Gujarat',
      ...gujaratSeller,
    });

    expect(result.transactionType).toBe('intra');
    expect(result.cgst).toBe(90);
    expect(result.sgst).toBe(90);
    expect(result.igst).toBe(0);
    expect(result.gstAmount).toBe(180);
    expect(result.invoiceAmount).toBe(1180);
  });

  it('Test 2: Gujarat seller + Delhi order => IGST 180 only', () => {
    const result = calculateGST({
      taxableValue: 1000,
      gstRate: 18,
      orderState: 'Delhi',
      sellerState: 'Gujarat',
      sellerGstin: '24ABCDE1234F1Z5',
    });

    expect(result.transactionType).toBe('inter');
    expect(result.igst).toBe(180);
    expect(result.cgst).toBe(0);
    expect(result.sgst).toBe(0);
    expect(result.gstAmount).toBe(180);
  });

  it('Test 3: Delhi seller + Delhi order => CGST + SGST', () => {
    const result = calculateGST({
      taxableValue: 1000,
      gstRate: 18,
      orderState: 'Delhi',
      sellerState: 'Delhi',
      sellerGstin: '07ABCDE1234F1Z5',
    });

    expect(result.transactionType).toBe('intra');
    expect(result.cgst).toBe(90);
    expect(result.sgst).toBe(90);
    expect(result.igst).toBe(0);
  });

  it('Test 4: Maharashtra seller + Gujarat order => IGST', () => {
    const result = calculateGST({
      taxableValue: 1000,
      gstRate: 18,
      orderState: 'Gujarat',
      sellerState: 'Maharashtra',
      sellerGstin: '27ABCDE1234F1Z5',
    });

    expect(result.transactionType).toBe('inter');
    expect(result.igst).toBe(180);
    expect(result.cgst).toBe(0);
    expect(result.sgst).toBe(0);
  });

  it('normalizeState handles casing and whitespace', () => {
    expect(normalizeState(' GUJARAT ')).toBe('gujarat');
    expect(normalizeState('gujarat')).toBe('gujarat');
    expect(normalizeState('Gujarat')).toBe('gujarat');
  });

  it('isIntraStateSupply uses GSTIN prefix vs customer state code', () => {
    expect(
      isIntraStateSupply({
        sellerGstin: '24ABCDE1234F1Z5',
        orderStateCode: '24',
      }),
    ).toBe(true);
    expect(
      isIntraStateSupply({
        sellerGstin: '24ABCDE1234F1Z5',
        orderState: 'Maharashtra',
      }),
    ).toBe(false);
  });

  it('buildSellerGstContext prefers first GSTIN as primary', () => {
    const ctx = buildSellerGstContext(['Gujarat'], ['24AAAAA0000A1Z5', '27BBBBB0000B1Z5']);
    expect(ctx.primaryGstin).toBe('24AAAAA0000A1Z5');
    expect(ctx.stateKeys.has('gujarat')).toBe(true);
  });
});

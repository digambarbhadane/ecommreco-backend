import {
  buildCustomerIndianStateCodeExpr,
  collectSellerRegistrationStateKeys,
  isSameIndianState,
  isSameIndianStateByCode,
  resolveCustomerIndianStateCode,
  resolveIndianStateKey,
  resolveIndianStateKeyFromGstin,
  resolveIndianStateCode,
} from '../../src/report-import/utils/gst-state.util';

describe('gst-state.util', () => {
  it('resolves full state names and abbreviations to the same key', () => {
    expect(resolveIndianStateKey('Gujarat')).toBe('gujarat');
    expect(resolveIndianStateKey('GJ')).toBe('gujarat');
    expect(resolveIndianStateKey('24')).toBe('gujarat');
    expect(resolveIndianStateKey('24 - Gujarat')).toBe('gujarat');
  });

  it('derives seller state from GSTIN prefix', () => {
    expect(resolveIndianStateKeyFromGstin('24AAAAA0000A1Z5')).toBe('gujarat');
    expect(resolveIndianStateKeyFromGstin('27AAAAA0000A1Z5')).toBe('maharashtra');
  });

  it('matches customer state to seller registration using GSTIN when state name is missing', () => {
    const sellerKeys = collectSellerRegistrationStateKeys([], ['24AAAAA0000A1Z5']);
    expect(isSameIndianState('Gujarat', sellerKeys)).toBe(true);
    expect(isSameIndianState('GJ', sellerKeys)).toBe(true);
    expect(isSameIndianState('24', sellerKeys)).toBe(true);
    expect(isSameIndianState('Maharashtra', sellerKeys)).toBe(false);
  });

  it('resolves single-digit state codes and compares by GSTIN prefix', () => {
    expect(resolveIndianStateKey(7)).toBe('delhi');
    expect(resolveIndianStateKey('7')).toBe('delhi');
    expect(resolveIndianStateCode(7)).toBe('07');
    expect(isSameIndianStateByCode('07', '07AAAAA0000A1Z5')).toBe(true);
    expect(isSameIndianStateByCode('7', '07AAAAA0000A1Z5')).toBe(true);
    expect(isSameIndianStateByCode('27', '07AAAAA0000A1Z5')).toBe(false);
  });

  it('resolveCustomerIndianStateCode prefers code field then state name', () => {
    expect(resolveCustomerIndianStateCode('7', 'maharashtra')).toBe('07');
    expect(resolveCustomerIndianStateCode('', 'Gujarat')).toBe('24');
    expect(resolveCustomerIndianStateCode('GJ', '')).toBe('24');
    expect(resolveCustomerIndianStateCode(null, 'delhi')).toBe('07');
  });

  it('buildCustomerIndianStateCodeExpr is a MongoDB switch expression', () => {
    const expr = buildCustomerIndianStateCodeExpr();
    expect(expr).toHaveProperty('$let');
  });
});

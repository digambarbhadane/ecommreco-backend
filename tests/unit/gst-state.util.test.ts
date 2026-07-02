import {
  collectSellerRegistrationStateKeys,
  isSameIndianState,
  resolveIndianStateKey,
  resolveIndianStateKeyFromGstin,
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
});

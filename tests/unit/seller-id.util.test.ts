import { Types } from 'mongoose';
import {
  buildGstIdFilter,
  buildGstIdsFilter,
  getSellerIdAliases,
} from '../../src/common/utils/seller-id.util';

describe('seller-id.util', () => {
  it('buildGstIdFilter includes string and ObjectId variants', () => {
    const gstId = '6a2304bbfaec1f7707f3b15e';
    const filter = buildGstIdFilter(gstId);
    expect(filter.gstId.$in).toHaveLength(1);
    expect(filter.gstId.$in[0]).toBe(gstId);
  });

  it('buildGstIdsFilter deduplicates gst ids', () => {
    const filter = buildGstIdsFilter(['abc', 'abc']);
    expect(filter.gstId.$in).toEqual(['abc']);
  });

  it('getSellerIdAliases includes object id, public id, and request id', () => {
    const aliases = getSellerIdAliases(
      {
        _id: new Types.ObjectId('6a2304bbfaec1f7707f3b15e'),
        publicId: 'seller-public-1',
      } as never,
      'user-login-id',
    );
    expect(aliases).toEqual(
      expect.arrayContaining([
        '6a2304bbfaec1f7707f3b15e',
        'seller-public-1',
        'user-login-id',
      ]),
    );
  });
});

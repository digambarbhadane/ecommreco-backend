import { buildCascadeDeleteFilter } from '../../src/common/utils/permanent-delete.util';

describe('Disconnect Marketplace Permanent Deletion Scope', () => {
  it('builds marketplace-scoped cascade delete filters matching linkId and scoped slugs', () => {
    const filter = buildCascadeDeleteFilter({
      sellerAliases: ['seller123'],
      gstId: '65f111111111111111111111',
      gstNumber: '24ACCF56309Q1ZP',
      marketplaceTokens: [
        {
          linkId: '65f222222222222222222222',
          platformId: '65f333333333333333333333',
          platformSlug: 'meesho',
          platformName: 'Meesho',
        },
      ],
      mode: 'marketplace',
    });

    expect(filter).toBeDefined();
    expect(filter).toHaveProperty('$and');

    const andClauses = (filter as { $and: Array<{ $or: unknown[] }> }).$and;
    expect(andClauses).toHaveLength(2);

    // Clause 1: Seller filter
    const sellerClause = andClauses[0].$or;
    expect(sellerClause).toEqual(
      expect.arrayContaining([{ sellerId: { $in: ['seller123'] } }]),
    );

    // Clause 2: Marketplace link IDs + GST-scoped platform slug
    const marketplaceClauses = andClauses[1].$or;
    expect(marketplaceClauses.length).toBeGreaterThan(0);

    // Contains direct link ID match
    expect(marketplaceClauses).toEqual(
      expect.arrayContaining([
        { marketplace: { $in: ['65f222222222222222222222'] } },
      ]),
    );

    // Contains GST-scoped slug match
    const compoundGstSlugClause = marketplaceClauses.find(
      (c) => typeof c === 'object' && c !== null && '$and' in c,
    ) as { $and: Array<{ $or: unknown[] }> } | undefined;

    expect(compoundGstSlugClause).toBeDefined();
    const gstOr = compoundGstSlugClause?.$and[0].$or;
    const slugOr = compoundGstSlugClause?.$and[1].$or;

    expect(gstOr).toEqual(
      expect.arrayContaining([
        { gstin: '24ACCF56309Q1ZP' },
        { gstNumber: '24ACCF56309Q1ZP' },
      ]),
    );
    expect(slugOr).toEqual(
      expect.arrayContaining([
        { marketplace: { $regex: /^meesho$/i } },
      ]),
    );
  });

  it('does not affect other marketplaces or other GSTs', () => {
    const filter = buildCascadeDeleteFilter({
      sellerAliases: ['seller123'],
      gstId: '65f111111111111111111111',
      gstNumber: '24ACCF56309Q1ZP',
      marketplaceTokens: [
        {
          linkId: '65f222222222222222222222',
          platformSlug: 'meesho',
        },
      ],
      mode: 'marketplace',
    });

    const jsonStr = JSON.stringify(filter);
    // Should not reference amazon or flipkart
    expect(jsonStr).not.toContain('amazon');
    expect(jsonStr).not.toContain('flipkart');
  });
});

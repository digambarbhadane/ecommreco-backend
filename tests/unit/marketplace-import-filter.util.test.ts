import { Types } from 'mongoose';
import {
  applyImportRowMarketplaceFilter,
  readSellerAliasesFromFilter,
  resolveSellerMarketplaceLinkIds,
} from '../../src/report-import/utils/marketplace-import-filter.util';

describe('marketplace-import-filter.util', () => {
  it('matches seller-marketplace link ObjectIds when a slug is provided', async () => {
    const filter: Record<string, unknown> = {
      sellerId: { $in: ['seller-1'] },
    };
    const marketplaceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                {
                  _id: new Types.ObjectId('674b0f6f2f8f9b0011223344'),
                  platformMarketplaceId: { slug: 'amazon', name: 'Amazon' },
                },
              ]),
            }),
          }),
        }),
      }),
    };

    await applyImportRowMarketplaceFilter(
      filter,
      marketplaceModel as never,
      readSellerAliasesFromFilter(filter),
      'amazon',
    );

    expect(filter.$and).toEqual([
      {
        $or: [
          { marketplace: { $regex: /^amazon/i } },
          {
            marketplace: {
              $in: ['674b0f6f2f8f9b0011223344'],
            },
          },
          {
            marketplace: {
              $in: [new Types.ObjectId('674b0f6f2f8f9b0011223344')],
            },
          },
        ],
      },
    ]);
  });

  it('resolves platform slugs to seller marketplace link ids', async () => {
    const marketplaceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                {
                  _id: 'mp-flipkart',
                  platformMarketplaceId: { slug: 'flipkart', name: 'Flipkart' },
                },
                {
                  _id: 'mp-amazon',
                  platformMarketplaceId: { slug: 'amazon', name: 'Amazon' },
                },
              ]),
            }),
          }),
        }),
      }),
    };

    const ids = await resolveSellerMarketplaceLinkIds(
      marketplaceModel as never,
      ['seller-1'],
      'flipkart',
    );

    expect(ids).toEqual(['mp-flipkart']);
    expect(marketplaceModel.find).toHaveBeenCalledWith({
      sellerId: { $in: ['seller-1'] },
    });
  });

  it('scopes slug resolution to a specific GST when gstId is provided', async () => {
    const marketplaceModel = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([
                {
                  _id: 'mp-amazon-gst-a',
                  platformMarketplaceId: { slug: 'amazon', name: 'Amazon' },
                },
              ]),
            }),
          }),
        }),
      }),
    };

    const ids = await resolveSellerMarketplaceLinkIds(
      marketplaceModel as never,
      ['seller-1'],
      'amazon',
      '674b0f6f2f8f9b0011223355',
    );

    expect(ids).toEqual(['mp-amazon-gst-a']);
    expect(marketplaceModel.find).toHaveBeenCalledWith({
      sellerId: { $in: ['seller-1'] },
      gstId: '674b0f6f2f8f9b0011223355',
    });
  });
});

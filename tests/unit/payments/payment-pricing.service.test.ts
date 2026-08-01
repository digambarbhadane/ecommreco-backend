import { PaymentPricingService } from '../../../src/payments/payment-pricing.service';

describe('PaymentPricingService', () => {
  const mockPackageModel = {
    findOne: jest.fn(),
  };
  const mockCouponModel = {
    findOne: jest.fn(),
  };

  let service: PaymentPricingService;

  beforeEach(() => {
    service = new PaymentPricingService(
      mockPackageModel as any,
      mockCouponModel as any,
    );
    jest.clearAllMocks();
  });

  it('calculates GST and total from plan base price', async () => {
    mockPackageModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'plan1',
        isActive: true,
        finalPriceAfterDiscount: 1000,
        basePrice: 1000,
        gstPercentage: 18,
        durationInDays: 30,
        gstSlots: 1,
      }),
    });

    const result = await service.calculateForPlan({ planId: 'plan1' });

    expect(result.pricing.baseAmount).toBe(1000);
    expect(result.pricing.gstAmount).toBe(180);
    expect(result.pricing.totalAmount).toBe(1180);
  });

  it('infers subscription type from duration', () => {
    expect(service.inferSubscriptionType(7)).toBe('trial');
    expect(service.inferSubscriptionType(30)).toBe('monthly');
    expect(service.inferSubscriptionType(90)).toBe('quarterly');
    expect(service.inferSubscriptionType(365)).toBe('yearly');
  });
});

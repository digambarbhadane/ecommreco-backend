import { ImportSessionService } from '../../src/report-import/services/import-session.service';

describe('ImportSessionService Amazon payment upload', () => {
  it('accepts a standalone payment report after session upload', async () => {
    const validation = {
      validateOwnership: jest.fn().mockResolvedValue({
        marketplaceIdentifier: 'amazon',
      }),
    };
    const uploadService = {
      uploadMarketplaceReport: jest.fn().mockResolvedValue({
        success: true,
      }),
    };
    const importWorkflow = {
      hasCompletedSlot: jest.fn(),
    };
    const service = new ImportSessionService(
      validation as never,
      uploadService as never,
      importWorkflow as never,
    );
    const dto = {
      sellerId: 'seller-1',
      gstId: 'gst-1',
      marketplaceId: 'amazon-link-1',
      reportMonth: '2026-07',
    };

    const created = await service.createSession('amazon', dto);
    service.addFile(
      created.sessionId,
      dto.sellerId,
      'paymentReportFile',
      {
        buffer: Buffer.from('payment workbook'),
        originalname: 'amazon-payment.xlsx',
      },
    );
    const result = await service.commit(created.sessionId, dto);

    expect(result).toEqual({ success: true });
    expect(uploadService.uploadMarketplaceReport).toHaveBeenCalledWith(
      'amazon',
      expect.objectContaining({
        paymentReportFile: expect.objectContaining({
          originalname: 'amazon-payment.xlsx',
        }),
      }),
      dto,
    );
    expect(importWorkflow.hasCompletedSlot).not.toHaveBeenCalled();
  });
});


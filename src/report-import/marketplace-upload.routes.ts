import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';

export const REPORT_UPLOAD_FILE_FIELDS = [
  { name: 'file', maxCount: 1 },
  { name: 'mtrB2bFile', maxCount: 1 },
  { name: 'mtrB2cFile', maxCount: 1 },
  { name: 'tcsSalesFile', maxCount: 1 },
  { name: 'tcsSalesReturnFile', maxCount: 1 },
  { name: 'orderReportFile', maxCount: 1 },
  { name: 'returnReportFile', maxCount: 1 },
  { name: 'paymentReportFile', maxCount: 1 },
  { name: 'gstrReportPackedFile', maxCount: 1 },
  { name: 'mDirectOrdersReportFile', maxCount: 1 },
  { name: 'salesRevenuePackedB2cFile', maxCount: 1 },
  { name: 'gstrReportRtoFile', maxCount: 1 },
  { name: 'gstrReportRtFile', maxCount: 1 },
  { name: 'mDirectReturnsReportFile', maxCount: 1 },
] as const;

export type MarketplaceUploadKey = 'flipkart' | 'amazon' | 'meesho' | 'myntra';

export type UploadedReportFiles = {
  file?: Array<{ buffer: Buffer; originalname: string }>;
  mtrB2bFile?: Array<{ buffer: Buffer; originalname: string }>;
  mtrB2cFile?: Array<{ buffer: Buffer; originalname: string }>;
  tcsSalesFile?: Array<{ buffer: Buffer; originalname: string }>;
  tcsSalesReturnFile?: Array<{ buffer: Buffer; originalname: string }>;
  orderReportFile?: Array<{ buffer: Buffer; originalname: string }>;
  returnReportFile?: Array<{ buffer: Buffer; originalname: string }>;
  paymentReportFile?: Array<{ buffer: Buffer; originalname: string }>;
  gstrReportPackedFile?: Array<{ buffer: Buffer; originalname: string }>;
  mDirectOrdersReportFile?: Array<{ buffer: Buffer; originalname: string }>;
  salesRevenuePackedB2cFile?: Array<{
    buffer: Buffer;
    originalname: string;
  }>;
  gstrReportRtoFile?: Array<{ buffer: Buffer; originalname: string }>;
  gstrReportRtFile?: Array<{ buffer: Buffer; originalname: string }>;
  mDirectReturnsReportFile?: Array<{
    buffer: Buffer;
    originalname: string;
  }>;
};

export function ReportUploadMultipart() {
  return applyDecorators(
    ApiConsumes('multipart/form-data'),
    UseInterceptors(
      FileFieldsInterceptor([...REPORT_UPLOAD_FILE_FIELDS], {
        limits: {
          fileSize: 100 * 1024 * 1024,
          files: 12,
        },
      }),
    ),
    Roles('seller', 'super_admin', 'accounts_manager'),
  );
}

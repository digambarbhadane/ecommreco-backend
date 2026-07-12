import { Injectable } from '@nestjs/common';
import {
  buildSellerGstContext,
  calculateGST,
  isIntraStateSupply,
  normalizeImportRowGst,
  normalizeState,
  splitGstForReport,
  type CalculateGstInput,
  type GstCalculationResult,
  type ImportRowGstInput,
  type ReportRowGstInput,
  type SellerGstContext,
} from './gst-calculation.core';

export {
  buildSellerGstContext,
  calculateGST,
  isIntraStateSupply,
  normalizeImportRowGst,
  normalizeState,
  splitGstForReport,
  type CalculateGstInput,
  type GstCalculationResult,
  type ImportRowGstInput,
  type ReportRowGstInput,
  type SellerGstContext,
};

/**
 * Central Indian GST calculation service.
 * Compares seller GST registration state vs order place-of-supply for all marketplaces.
 */
@Injectable()
export class GstService {
  normalizeState(state?: string | null): string {
    return normalizeState(state);
  }

  buildSellerGstContext(
    sellerStates?: string | string[] | null,
    sellerGstins?: string | string[] | null,
  ): SellerGstContext {
    return buildSellerGstContext(sellerStates, sellerGstins);
  }

  isIntraStateSupply(
    input: Parameters<typeof isIntraStateSupply>[0],
  ): boolean | null {
    return isIntraStateSupply(input);
  }

  calculateGST(input: CalculateGstInput): GstCalculationResult {
    return calculateGST(input);
  }

  normalizeImportRowGst(
    row: ImportRowGstInput,
    sellerContext: SellerGstContext,
  ): ImportRowGstInput {
    return normalizeImportRowGst(row, sellerContext);
  }

  splitGstForReport(
    row: ReportRowGstInput,
    sellerContext: SellerGstContext,
    sign?: number,
  ): { igst: number; cgst: number; sgst: number } {
    return splitGstForReport(row, sellerContext, sign);
  }
}

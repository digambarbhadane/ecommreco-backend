import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as ExcelJS from 'exceljs';
import { PassThrough } from 'node:stream';
import { Model } from 'mongoose';
import { resolveSellerIdAliases } from '../common/utils/seller-id.util';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import type { ListDisputesDto } from './dto/list-disputes.dto';
import type { ListSettlementsDto } from './dto/list-settlements.dto';
import type { NormalizedTransaction } from './schemas/normalized-transaction.schema';
import { SettlementRepository } from './settlement.repository';

@Injectable()
export class SettlementService {
  constructor(
    private readonly repository: SettlementRepository,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<SellerDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async list(query: ListSettlementsDto) {
    return this.repository.list(query, await this.sellerAliases(query.sellerId));
  }

  async summary(query: ListSettlementsDto) {
    return this.repository.summary(
      query,
      await this.sellerAliases(query.sellerId),
    );
  }

  async listDisputes(query: ListDisputesDto) {
    return this.repository.listDisputes(
      query,
      await this.sellerAliases(query.sellerId),
    );
  }

  async disputeSummary(query: ListDisputesDto) {
    return this.repository.disputeSummary(
      query,
      await this.sellerAliases(query.sellerId),
    );
  }

  async detail(query: ListSettlementsDto, orderId: string) {
    const result = await this.repository.findOrder(
      query,
      orderId,
      await this.sellerAliases(query.sellerId),
    );
    if (!result.calculation) {
      throw new NotFoundException(`Settlement order ${orderId} was not found`);
    }
    return {
      order: {
        orderId: result.calculation.orderId,
        marketplace: result.calculation.marketplace,
        currency: result.calculation.currency,
      },
      settlement: {
        orderDate: result.calculation.orderDate,
        settlementDate: result.calculation.settlementDate,
        status: result.calculation.status,
      },
      transactionHistory: result.transactions,
      expenseBreakdown: result.expenseBreakdown,
      calculationSummary: result.calculation,
    };
  }

  async createExport(query: ListSettlementsDto) {
    const stream = new PassThrough();
    const aliases = await this.sellerAliases(query.sellerId);
    void this.writeExport(query, aliases, stream);
    return stream;
  }

  private async writeExport(
    query: ListSettlementsDto,
    sellerAliases: string[],
    stream: PassThrough,
  ): Promise<void> {
    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream,
        useStyles: true,
        useSharedStrings: true,
      });
      const sheet = workbook.addWorksheet('Settlements');
      sheet.columns = [
        { header: 'Marketplace', key: 'marketplace', width: 18 },
        { header: 'Order Date', key: 'orderDate', width: 18 },
        { header: 'Order ID', key: 'orderId', width: 28 },
        { header: 'Gross Sale', key: 'grossSale', width: 16 },
        { header: 'Returns', key: 'returns', width: 16 },
        { header: 'Net Sale', key: 'netSale', width: 16 },
        { header: 'Expenses', key: 'expenses', width: 16 },
        { header: 'Receivable', key: 'receivable', width: 16 },
        { header: 'Received', key: 'received', width: 16 },
        { header: 'Difference', key: 'difference', width: 16 },
        { header: 'Status', key: 'status', width: 18 },
      ];
      sheet.getRow(1).font = { bold: true };
      const cursor = this.repository.exportCursor(query, sellerAliases);
      for await (const row of cursor) {
        sheet
          .addRow({
            ...row,
            orderDate: row.orderDate
              ? new Date(row.orderDate)
              : '',
          })
          .commit();
      }
      sheet.commit();
      await workbook.commit();
    } catch (error) {
      stream.destroy(error as Error);
    }
  }

  async replaceNormalizedUpload(
    uploadId: string,
    transactions: NormalizedTransaction[],
  ) {
    return this.repository.replaceUpload(uploadId, transactions);
  }

  async replaceNormalizedScope(
    scope: {
      sellerId: string;
      marketplace: string;
      reportMonth?: string;
      sourceType: string;
    },
    transactions: NormalizedTransaction[],
  ) {
    return this.repository.replaceScope(scope, transactions);
  }

  async deleteNormalizedUpload(uploadId: string) {
    return this.repository.deleteUpload(uploadId);
  }

  private sellerAliases(sellerId: string) {
    return resolveSellerIdAliases(
      this.sellerModel,
      this.userModel,
      sellerId,
    );
  }
}

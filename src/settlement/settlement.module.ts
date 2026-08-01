import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  NormalizedTransaction,
  NormalizedTransactionSchema,
} from './schemas/normalized-transaction.schema';
import { DisputeController } from './dispute.controller';
import { SettlementController } from './settlement.controller';
import { SettlementRepository } from './settlement.repository';
import { SettlementService } from './settlement.service';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: NormalizedTransaction.name,
        schema: NormalizedTransactionSchema,
      },
      { name: Seller.name, schema: SellerSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [SettlementController, DisputeController],
  providers: [SettlementRepository, SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}

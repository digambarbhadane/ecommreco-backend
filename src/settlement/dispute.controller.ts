import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ListDisputesDto } from './dto/list-disputes.dto';
import { SettlementService } from './settlement.service';

type RequestWithUser = Request & {
  user?: { id?: string; role?: string };
};

@ApiTags('Disputes')
@ApiBearerAuth()
@Controller('disputes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('seller', 'super_admin', 'accounts_manager')
export class DisputeController {
  constructor(private readonly service: SettlementService) {}

  private assertSeller(query: ListDisputesDto) {
    if (!query.sellerId?.trim()) {
      throw new BadRequestException('sellerId is required');
    }
  }

  private scopedQuery(
    query: ListDisputesDto,
    request: RequestWithUser,
  ): ListDisputesDto {
    const scoped = Object.assign(new ListDisputesDto(), query);
    if (request.user?.role === 'seller' && request.user.id) {
      scoped.sellerId = request.user.id;
    }
    this.assertSeller(scoped);
    return scoped;
  }

  @Get()
  @ApiOperation({
    summary: 'List dispute orders by due / overdue / payout difference',
    description:
      'Orders with incomplete payouts. Invoice age ≤30 days = due; >30 days = overdue. Over charges logic is pending.',
  })
  list(@Query() query: ListDisputesDto, @Req() request: RequestWithUser) {
    return this.service.listDisputes(this.scopedQuery(query, request));
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'Dispute summary cards (due, overdue, payout difference, over charges)',
  })
  summary(@Query() query: ListDisputesDto, @Req() request: RequestWithUser) {
    return this.service.disputeSummary(this.scopedQuery(query, request));
  }
}

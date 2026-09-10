import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GstStateService } from './gst-state.service';

@ApiTags('GST States')
@Controller('gst-states')
export class GstStateController {
  constructor(private readonly gstStateService: GstStateService) {}

  @Get()
  @ApiOperation({ summary: 'List all GST states sorted by state code' })
  async findAll() {
    const states = await this.gstStateService.findAll();
    return { success: true, data: states };
  }

  @Get('code/:code')
  @ApiOperation({ summary: 'Get state by numeric GST state code' })
  async findByCode(@Param('code') code: string) {
    const state = await this.gstStateService.findByStateCode(Number(code));
    if (!state) throw new NotFoundException(`State code ${code} not found`);
    return { success: true, data: state };
  }

  @Get('short/:short')
  @ApiOperation({ summary: 'Get state by short name (e.g. GJ, MH, DL)' })
  async findByShort(@Param('short') short: string) {
    const state = await this.gstStateService.findByShortName(short);
    if (!state) throw new NotFoundException(`Short name ${short} not found`);
    return { success: true, data: state };
  }

  @Get('gstin/:gstin')
  @ApiOperation({ summary: 'Get state from GSTIN prefix (first 2 digits)' })
  async findByGstin(@Param('gstin') gstin: string) {
    const state = await this.gstStateService.findByGstinPrefix(gstin);
    if (!state)
      throw new NotFoundException(
        `No state for GSTIN prefix ${gstin.slice(0, 2)}`,
      );
    return { success: true, data: state };
  }
}

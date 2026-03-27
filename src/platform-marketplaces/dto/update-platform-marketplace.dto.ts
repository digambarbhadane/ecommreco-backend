import { PartialType } from '@nestjs/mapped-types';
import { CreatePlatformMarketplaceDto } from './create-platform-marketplace.dto';

export class UpdatePlatformMarketplaceDto extends PartialType(
  CreatePlatformMarketplaceDto,
) {}

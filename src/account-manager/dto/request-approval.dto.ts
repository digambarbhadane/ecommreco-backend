import { IsNotEmpty, IsString } from 'class-validator';

export class RequestAdminApprovalDto {
  @IsNotEmpty()
  @IsString()
  sellerId: string;
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { MongoServerError } from 'mongodb';
import { isMongoStorageQuotaError } from '../utils/mongo-errors';

@Catch(MongoServerError)
export class MongoServerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MongoServerExceptionFilter.name);

  catch(exception: MongoServerError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (isMongoStorageQuotaError(exception)) {
      this.logger.error(`MongoDB storage quota: ${exception.message}`);
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        success: false,
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: 'DATABASE_STORAGE_FULL',
        message:
          'Database storage is full. Deletes and other writes are blocked until space is freed. Please contact your administrator or upgrade database storage.',
      });
      return;
    }

    this.logger.error(exception.message, exception.stack);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: 'DATABASE_ERROR',
      message: 'A database error occurred. Please try again later.',
    });
  }
}

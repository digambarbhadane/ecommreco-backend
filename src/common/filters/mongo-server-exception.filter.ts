import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { MongoNotConnectedError, MongoServerError } from 'mongodb';
import {
  isMongoDisconnectedError,
  isMongoStorageQuotaError,
} from '../utils/mongo-errors';

@Catch(MongoServerError, MongoNotConnectedError)
export class MongoServerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MongoServerExceptionFilter.name);

  catch(
    exception: MongoServerError | MongoNotConnectedError,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (isMongoDisconnectedError(exception)) {
      this.logger.error(`MongoDB disconnected: ${exception.message}`);
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        success: false,
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: 'DATABASE_UNAVAILABLE',
        message: 'Database is reconnecting. Please retry in a moment.',
      });
      return;
    }

    if (!(exception instanceof MongoServerError)) {
      this.logger.error(exception.message, exception.stack);
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: 'DATABASE_ERROR',
        message: 'A database error occurred. Please try again later.',
      });
      return;
    }

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

    const duplicateField = this.getDuplicateKeyField(exception);
    if (duplicateField) {
      const message = this.duplicateKeyMessage(duplicateField);
      response.status(HttpStatus.CONFLICT).json({
        success: false,
        statusCode: HttpStatus.CONFLICT,
        errorCode: 'DUPLICATE_KEY',
        message,
      });
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: 'DATABASE_ERROR',
      message: 'A database error occurred. Please try again later.',
    });
  }

  private getDuplicateKeyField(exception: MongoServerError): string | null {
    if (exception.code !== 11000) return null;
    const keyValue = exception.keyValue as Record<string, unknown> | undefined;
    if (keyValue && typeof keyValue === 'object') {
      const field = Object.keys(keyValue)[0];
      return field ?? null;
    }
    const match = exception.message.match(/index:\s+(\S+)/);
    return match?.[1]?.replace(/_1$/, '') ?? null;
  }

  private duplicateKeyMessage(field: string): string {
    const normalized = field.toLowerCase();
    if (normalized.includes('publicid')) {
      return 'An account already exists. Please login or use a different email.';
    }
    if (normalized.includes('email')) {
      return 'An account with this email already exists.';
    }
    if (normalized.includes('pannumber') || normalized === 'pan') {
      return 'This PAN has already been registered.';
    }
    if (normalized.includes('gstnumber') || normalized.includes('gst')) {
      return 'This GST number has already been registered.';
    }
    if (normalized.includes('mobile') || normalized.includes('contact')) {
      return 'This mobile number is already registered.';
    }
    return 'This record already exists. Please use different details or login.';
  }
}

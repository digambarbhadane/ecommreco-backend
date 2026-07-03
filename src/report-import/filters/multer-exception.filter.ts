import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { MulterError } from 'multer';
import { UPLOAD_MAX_FILE_MB } from '../../config/upload-limits';

@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    let message = 'File upload failed. Please try again.';

    if (exception.code === 'LIMIT_FILE_SIZE') {
      message = `File is too large. Each report file must be ${UPLOAD_MAX_FILE_MB} MB or smaller.`;
    } else if (exception.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files were uploaded in one request.';
    } else if (exception.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Unexpected file field in upload request.';
    } else if (exception.message) {
      message = `File upload failed: ${exception.message}`;
    }

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      error: 'Bad Request',
    });
  }
}

'use strict';

/**
 * Standardized application error with HTTP status code and error code.
 */
class AppError extends Error {
  constructor(errorCode, statusCode, message, details = null) {
    super(message);
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      errorCode: this.errorCode,
      message: this.message,
      details: this.details,
    };
  }
}

// Pre-defined error codes
AppError.codes = {
  // General
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // Booking specific
  NO_SHOW_BLOCKED: 'NO_SHOW_BLOCKED',
  TABLE_CONFLICT: 'TABLE_CONFLICT',
  TABLE_ALREADY_RESERVED: 'TABLE_ALREADY_RESERVED',
  TABLE_HOLD_CONFLICT: 'TABLE_HOLD_CONFLICT',
  INVALID_BOOKING_TIME: 'INVALID_BOOKING_TIME',
  BOOKING_NOT_CANCELLABLE: 'BOOKING_NOT_CANCELLABLE',
  BOOKING_NOT_RESCHEDULABLE: 'BOOKING_NOT_RESCHEDULABLE',
  VOUCHER_INVALID: 'VOUCHER_INVALID',

  // Payment
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REFUND_FAILED: 'REFUND_FAILED',

  // Rate limit
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
};

module.exports = AppError;

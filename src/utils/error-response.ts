import { Response } from 'express'
import { logger } from '../config/logger'
import { config } from '../config/env'

export interface ErrorResponse {
  success: false
  error: {
    code: string
    message: string
    timestamp: string
    requestId?: string
    details?: any
    stack?: string
  }
}

export interface ValidationErrorResponse extends ErrorResponse {
  error: ErrorResponse['error'] & {
    validation: {
      field: string
      message: string
      provided?: any
    }[]
  }
}

/**
 * Standard error codes for the API
 */
export const ErrorCodes = {
  // Authentication & Authorization
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_SIGNATURE_INVALID: 'AUTH_SIGNATURE_INVALID',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_UUID_FORMAT: 'INVALID_UUID_FORMAT',
  INVALID_QUERY_PARAMETERS: 'INVALID_QUERY_PARAMETERS',
  INVALID_PAGINATION: 'INVALID_PAGINATION',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  
  // Database & Resources
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  DATABASE_ERROR: 'DATABASE_ERROR',
  DATABASE_CONNECTION_LOST: 'DATABASE_CONNECTION_LOST',
  DATABASE_TIMEOUT: 'DATABASE_TIMEOUT',
  
  // Business Logic
  DECK_VALIDATION_FAILED: 'DECK_VALIDATION_FAILED',
  CARD_NOT_FOUND: 'CARD_NOT_FOUND',
  GAME_NOT_SUPPORTED: 'GAME_NOT_SUPPORTED',
  FORMAT_NOT_SUPPORTED: 'FORMAT_NOT_SUPPORTED',
  
  // System
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

/**
 * Generate a unique request ID for error tracking
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  code: ErrorCode,
  message: string,
  details?: any,
  requestId?: string
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      timestamp: new Date().toISOString(),
      requestId: requestId || generateRequestId(),
      details: config.NODE_ENV === 'development' ? details : undefined
    }
  }
}

/**
 * Create a validation error response
 */
export function createValidationErrorResponse(
  message: string,
  validationErrors: Array<{ field: string; message: string; provided?: any }>,
  requestId?: string
): ValidationErrorResponse {
  return {
    success: false,
    error: {
      code: ErrorCodes.VALIDATION_ERROR,
      message,
      timestamp: new Date().toISOString(),
      requestId: requestId || generateRequestId(),
      validation: validationErrors
    }
  }
}

/**
 * Handle and respond to authentication errors
 */
export function handleAuthError(
  res: Response,
  error: Error,
  userAgent?: string,
  ip?: string
): Response {
  const requestId = generateRequestId()
  
  logger.error('Authentication error', {
    error: error.message,
    errorName: error.name,
    requestId,
    userAgent,
    ip
  })

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json(createErrorResponse(
      ErrorCodes.AUTH_TOKEN_EXPIRED,
      'Authentication token has expired',
      { expiredAt: error.message },
      requestId
    ))
  }

  if (error.name === 'JsonWebTokenError') {
    const isSignatureError = error.message.includes('invalid signature')
    const code = isSignatureError ? ErrorCodes.AUTH_SIGNATURE_INVALID : ErrorCodes.AUTH_TOKEN_INVALID
    
    return res.status(401).json(createErrorResponse(
      code,
      isSignatureError 
        ? 'Token signature validation failed' 
        : 'Invalid authentication token',
      { originalError: error.message },
      requestId
    ))
  }

  return res.status(401).json(createErrorResponse(
    ErrorCodes.AUTH_TOKEN_INVALID,
    'Authentication failed',
    { originalError: error.message },
    requestId
  ))
}

/**
 * Handle and respond to database errors
 */
export function handleDatabaseError(
  res: Response,
  error: Error,
  context?: string
): Response {
  const requestId = generateRequestId()
  
  logger.error('Database error', {
    error: error.message,
    errorName: error.name,
    context,
    requestId
  })

  if (error.message.includes('ECONNREFUSED') || error.message.includes('connect timeout')) {
    return res.status(503).json(createErrorResponse(
      ErrorCodes.DATABASE_CONNECTION_LOST,
      'Database connection unavailable - please try again later',
      { context },
      requestId
    ))
  }

  if (error.message.includes('timeout') || error.message.includes('query timeout')) {
    return res.status(504).json(createErrorResponse(
      ErrorCodes.DATABASE_TIMEOUT,
      'Database query timeout - please try again',
      { context },
      requestId
    ))
  }

  if (error.message.includes('invalid input syntax for type uuid')) {
    return res.status(400).json(createErrorResponse(
      ErrorCodes.INVALID_UUID_FORMAT,
      'Invalid UUID format provided',
      { context },
      requestId
    ))
  }

  return res.status(500).json(createErrorResponse(
    ErrorCodes.DATABASE_ERROR,
    'Database operation failed',
    { context },
    requestId
  ))
}

/**
 * Handle and respond to validation errors
 */
export function handleValidationError(
  res: Response,
  field: string,
  message: string,
  provided?: any
): Response {
  const requestId = generateRequestId()
  
  return res.status(400).json(createValidationErrorResponse(
    'Request validation failed',
    [{ field, message, provided }],
    requestId
  ))
}

/**
 * Handle generic server errors
 */
export function handleServerError(
  res: Response,
  error: Error,
  context?: string
): Response {
  const requestId = generateRequestId()
  
  logger.error('Server error', {
    error: error.message,
    stack: error.stack,
    context,
    requestId
  })

  return res.status(500).json(createErrorResponse(
    ErrorCodes.INTERNAL_SERVER_ERROR,
    'An unexpected error occurred',
    { 
      context,
      stack: config.NODE_ENV === 'development' ? error.stack : undefined
    },
    requestId
  ))
}
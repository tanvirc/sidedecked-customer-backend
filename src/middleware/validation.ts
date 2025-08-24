import { Request, Response, NextFunction } from 'express'
import { logger } from '../config/logger'

/**
 * Validate UUID format in request parameters
 */
export const validateUUID = (paramName: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const uuid = req.params[paramName]
    
    if (!uuid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: `Missing required parameter: ${paramName}`,
          timestamp: new Date().toISOString()
        }
      })
    }

    // UUID v4 format: 8-4-4-4-12 hexadecimal digits
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    
    if (!uuidRegex.test(uuid)) {
      logger.warn('Invalid UUID format provided', {
        paramName,
        providedValue: uuid,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        url: req.url
      })
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_UUID_FORMAT',
          message: `Invalid UUID format for parameter '${paramName}'. Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`,
          parameter: paramName,
          provided: uuid,
          timestamp: new Date().toISOString()
        }
      })
    }

    next()
  }
}

/**
 * Validate multiple UUID parameters
 */
export const validateUUIDs = (...paramNames: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const invalidParams: { param: string; value: string }[] = []

    for (const paramName of paramNames) {
      const uuid = req.params[paramName]
      
      if (uuid && !uuidRegex.test(uuid)) {
        invalidParams.push({ param: paramName, value: uuid })
      }
    }

    if (invalidParams.length > 0) {
      logger.warn('Multiple invalid UUID formats provided', {
        invalidParams,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        url: req.url
      })

      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_UUID_FORMAT',
          message: 'One or more parameters have invalid UUID format',
          invalidParameters: invalidParams,
          expectedFormat: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
          timestamp: new Date().toISOString()
        }
      })
    }

    next()
  }
}

/**
 * Sanitize and validate query parameters
 */
export const validateQueryParams = (allowedParams: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const queryKeys = Object.keys(req.query)
    const invalidParams = queryKeys.filter(key => !allowedParams.includes(key))

    if (invalidParams.length > 0) {
      logger.warn('Invalid query parameters provided', {
        invalidParams,
        allowedParams,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        url: req.url
      })

      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY_PARAMETERS',
          message: 'One or more query parameters are not allowed',
          invalidParameters: invalidParams,
          allowedParameters: allowedParams,
          timestamp: new Date().toISOString()
        }
      })
    }

    next()
  }
}

/**
 * Validate pagination parameters
 */
export const validatePagination = (req: Request, res: Response, next: NextFunction) => {
  const { page, limit, offset } = req.query

  if (page !== undefined) {
    const pageNum = parseInt(page as string, 10)
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: 'Page parameter must be a positive integer',
          provided: page,
          timestamp: new Date().toISOString()
        }
      })
    }
  }

  if (limit !== undefined) {
    const limitNum = parseInt(limit as string, 10)
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: 'Limit parameter must be between 1 and 100',
          provided: limit,
          timestamp: new Date().toISOString()
        }
      })
    }
  }

  if (offset !== undefined) {
    const offsetNum = parseInt(offset as string, 10)
    if (isNaN(offsetNum) || offsetNum < 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: 'Offset parameter must be a non-negative integer',
          provided: offset,
          timestamp: new Date().toISOString()
        }
      })
    }
  }

  next()
}
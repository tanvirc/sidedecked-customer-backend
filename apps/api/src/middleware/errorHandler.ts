import { Request, Response, NextFunction } from 'express'
import { ValidationError } from 'express-validator'

export interface APIError extends Error {
  statusCode?: number
  code?: string
  details?: any
}

export const errorHandler = (
  error: APIError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = error.statusCode || 500
  const message = error.message || 'Internal Server Error'
  
  // Log error
  console.error(`❌ ${req.method} ${req.path} - ${statusCode} - ${message}`, {
    error: error.stack,
    body: req.body,
    query: req.query,
    params: req.params
  })

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message,
      details: error.details,
      timestamp: new Date().toISOString(),
      path: req.path
    }
  })
}

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      timestamp: new Date().toISOString(),
      path: req.path
    }
  })
}

export const createError = (
  message: string,
  statusCode: number = 500,
  code?: string,
  details?: any
): APIError => {
  const error = new Error(message) as APIError
  error.statusCode = statusCode
  error.code = code
  error.details = details
  return error
}

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
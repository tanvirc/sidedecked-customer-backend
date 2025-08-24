import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config/env'
import { logger } from '../config/logger'
import { handleAuthError, createErrorResponse, ErrorCodes } from '../utils/error-response'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email: string
    actor_id: string
    actor_type: string
    auth_identity_id: string
  }
}

export interface JWTPayload {
  actor_id: string
  actor_type: string
  auth_identity_id: string
  app_metadata?: {
    customer_id?: string
  }
  iat?: number
  exp?: number
}

/**
 * Middleware to authenticate requests using JWT tokens
 * Extracts user information from the Authorization header
 */
export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null

    if (!token) {
      logger.warn('Authentication failed: No token provided', {
        headers: req.headers,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      })
      return res.status(401).json(createErrorResponse(
        ErrorCodes.AUTH_TOKEN_MISSING,
        'Access token required'
      ))
    }

    // Verify JWT token
    const decoded = jwt.verify(token, config.JWT_SECRET) as JWTPayload

    if (!decoded.actor_id || decoded.actor_type !== 'customer') {
      logger.warn('Authentication failed: Invalid token format', {
        tokenPayload: {
          actor_id: decoded.actor_id,
          actor_type: decoded.actor_type,
          hasCustomerId: !!decoded.app_metadata?.customer_id
        },
        userAgent: req.get('User-Agent'),
        ip: req.ip
      })
      return res.status(401).json(createErrorResponse(
        ErrorCodes.AUTH_TOKEN_INVALID,
        'Invalid token format or not a customer token'
      ))
    }

    // Extract user information from token
    req.user = {
      id: decoded.app_metadata?.customer_id || decoded.actor_id,
      email: '', // We don't have email in JWT, will need to fetch if needed
      actor_id: decoded.actor_id,
      actor_type: decoded.actor_type,
      auth_identity_id: decoded.auth_identity_id
    }

    next()
  } catch (error) {
    return handleAuthError(
      res,
      error as Error,
      req.get('User-Agent'),
      req.ip
    )
  }
}

/**
 * Optional authentication middleware - doesn't fail if no token provided
 * Sets req.user if valid token is present
 */
export const optionalAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null

    if (!token) {
      // No token provided, continue without authentication
      return next()
    }

    // Verify JWT token
    const decoded = jwt.verify(token, config.JWT_SECRET) as JWTPayload

    if (decoded.actor_id && decoded.actor_type === 'customer') {
      // Extract user information from token
      req.user = {
        id: decoded.app_metadata?.customer_id || decoded.actor_id,
        email: '', // We don't have email in JWT, will need to fetch if needed
        actor_id: decoded.actor_id,
        actor_type: decoded.actor_type,
        auth_identity_id: decoded.auth_identity_id
      }
    }

    next()
  } catch (error) {
    // If token is invalid, continue without authentication rather than failing
    logger.warn('Optional auth failed, continuing without user context', { 
      error: (error as Error).message 
    })
    next()
  }
}
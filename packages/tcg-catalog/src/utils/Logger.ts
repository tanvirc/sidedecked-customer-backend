import * as winston from 'winston'

export interface LogContext {
  gameCode?: string
  jobId?: string
  cardId?: string
  printId?: string
  sku?: string
  operation?: string
  duration?: number
  [key: string]: any
}

class TCGLogger {
  private logger: winston.Logger

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return JSON.stringify({
            timestamp,
            level,
            message,
            service: 'tcg-catalog',
            ...meta
          })
        })
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              const metaStr = Object.keys(meta).length ? 
                ` ${JSON.stringify(meta)}` : ''
              return `${timestamp} [${level}] ${message}${metaStr}`
            })
          )
        })
      ]
    })

    // Add file transport in production
    if (process.env.NODE_ENV === 'production') {
      this.logger.add(new winston.transports.File({
        filename: 'logs/tcg-catalog-error.log',
        level: 'error'
      }))
      
      this.logger.add(new winston.transports.File({
        filename: 'logs/tcg-catalog.log'
      }))
    }
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(message, context)
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.logger.error(message, {
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined,
      ...context
    })
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, context)
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, context)
  }

  // ETL-specific logging methods
  etlStarted(jobId: string, gameCode: string, jobType: string): void {
    this.info('ETL job started', {
      jobId,
      gameCode,
      jobType,
      operation: 'etl_start'
    })
  }

  etlCompleted(jobId: string, gameCode: string, result: any): void {
    this.info('ETL job completed', {
      jobId,
      gameCode,
      operation: 'etl_complete',
      duration: result.duration,
      cardsProcessed: result.totalProcessed,
      cardsCreated: result.cardsCreated,
      cardsUpdated: result.cardsUpdated
    })
  }

  etlFailed(jobId: string, gameCode: string, error: Error): void {
    this.error('ETL job failed', error, {
      jobId,
      gameCode,
      operation: 'etl_fail'
    })
  }

  etlProgress(jobId: string, processed: number, total: number): void {
    const percentage = total > 0 ? Math.round((processed / total) * 100) : 0
    this.debug('ETL progress update', {
      jobId,
      processed,
      total,
      percentage,
      operation: 'etl_progress'
    })
  }

  // Image processing logging
  imageProcessingStarted(printId: string, imageType: string, sourceUrl: string): void {
    this.info('Image processing started', {
      printId,
      imageType,
      sourceUrl,
      operation: 'image_start'
    })
  }

  imageProcessingCompleted(printId: string, imageType: string, duration: number): void {
    this.info('Image processing completed', {
      printId,
      imageType,
      duration,
      operation: 'image_complete'
    })
  }

  imageProcessingFailed(printId: string, imageType: string, error: Error): void {
    this.error('Image processing failed', error, {
      printId,
      imageType,
      operation: 'image_fail'
    })
  }

  // Search indexing logging
  searchIndexStarted(operation: string, itemCount?: number): void {
    this.info('Search indexing started', {
      operation: `search_${operation}`,
      itemCount
    })
  }

  searchIndexCompleted(operation: string, itemCount: number, duration: number): void {
    this.info('Search indexing completed', {
      operation: `search_${operation}`,
      itemCount,
      duration
    })
  }

  // API call logging
  apiCall(provider: string, endpoint: string, method: string = 'GET'): void {
    this.debug('External API call', {
      provider,
      endpoint,
      method,
      operation: 'api_call'
    })
  }

  apiCallFailed(provider: string, endpoint: string, error: Error, retryAttempt?: number): void {
    this.warn('External API call failed', {
      provider,
      endpoint,
      error: error.message,
      retryAttempt,
      operation: 'api_fail'
    })
  }

  // Circuit breaker logging
  circuitBreakerOpened(provider: string, failureCount: number): void {
    this.warn('Circuit breaker opened', {
      provider,
      failureCount,
      operation: 'circuit_breaker_open'
    })
  }

  circuitBreakerClosed(provider: string): void {
    this.info('Circuit breaker closed', {
      provider,
      operation: 'circuit_breaker_close'
    })
  }

  // Performance logging
  performanceLog(operation: string, duration: number, context?: LogContext): void {
    this.debug('Performance measurement', {
      operation,
      duration,
      ...context
    })
  }

  // Database operation logging
  databaseQuery(query: string, duration: number, rowCount?: number): void {
    this.debug('Database query executed', {
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      duration,
      rowCount,
      operation: 'db_query'
    })
  }

  databaseError(query: string, error: Error): void {
    this.error('Database query failed', error, {
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      operation: 'db_error'
    })
  }

  // Cache logging
  cacheHit(key: string, operation: string): void {
    this.debug('Cache hit', {
      key,
      operation: `cache_${operation}_hit`
    })
  }

  cacheMiss(key: string, operation: string): void {
    this.debug('Cache miss', {
      key,
      operation: `cache_${operation}_miss`
    })
  }

  cacheSet(key: string, ttl: number, operation: string): void {
    this.debug('Cache set', {
      key,
      ttl,
      operation: `cache_${operation}_set`
    })
  }
}

// Export singleton instance
export const logger = new TCGLogger()

// Export timing decorator
export function logTiming(operation: string, context?: LogContext) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now()
      try {
        const result = await method.apply(this, args)
        const duration = Date.now() - startTime
        logger.performanceLog(`${operation}:${propertyName}`, duration, context)
        return result
      } catch (error) {
        const duration = Date.now() - startTime
        logger.error(`${operation}:${propertyName} failed`, error as Error, {
          duration,
          ...context
        })
        throw error
      }
    }
  }
}

// Export error boundary decorator
export function logErrors(context?: LogContext) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value

    descriptor.value = async function (...args: any[]) {
      try {
        return await method.apply(this, args)
      } catch (error) {
        logger.error(`Error in ${propertyName}`, error as Error, context)
        throw error
      }
    }
  }
}
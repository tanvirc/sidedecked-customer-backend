import { shouldDebug, type DebugCategory } from '../config/debug'
import { logger } from '../config/logger'

/**
 * Debug-aware console logging
 * Only logs if the 'console' debug category is enabled
 */
export function debugLog(message: string, ...args: any[]): void {
  if (shouldDebug('console')) {
    console.log(`🐛 DEBUG: ${message}`, ...args)
  }
}

/**
 * Debug-aware console warning
 * Only logs if the 'console' debug category is enabled
 */
export function debugWarn(message: string, ...args: any[]): void {
  if (shouldDebug('console')) {
    console.warn(`🐛 DEBUG WARN: ${message}`, ...args)
  }
}

/**
 * Debug-aware console error
 * Only logs if the 'console' debug category is enabled
 */
export function debugError(message: string, ...args: any[]): void {
  if (shouldDebug('console')) {
    console.error(`🐛 DEBUG ERROR: ${message}`, ...args)
  }
}

/**
 * Debug-aware logger.debug wrapper
 * Only logs if the 'logger' debug category is enabled
 */
export function debugInfo(message: string, context?: any): void {
  if (shouldDebug('logger')) {
    logger.debug(`🐛 ${message}`, context)
  }
}

/**
 * Category-specific debug logging
 * Only logs if the specified category is enabled
 */
export function debugCategory(category: DebugCategory, message: string, ...args: any[]): void {
  if (shouldDebug(category)) {
    console.log(`🐛 DEBUG [${category.toUpperCase()}]: ${message}`, ...args)
  }
}

/**
 * Performance timing debug utility
 * Only executes if 'performance' category is enabled
 */
export class DebugTimer {
  private startTime: number
  private label: string

  constructor(label: string) {
    this.label = label
    this.startTime = shouldDebug('performance') ? performance.now() : 0
    
    if (shouldDebug('performance')) {
      debugCategory('performance', `⏱️  Started: ${label}`)
    }
  }

  end(): number {
    if (!shouldDebug('performance')) {
      return 0
    }

    const endTime = performance.now()
    const duration = endTime - this.startTime
    debugCategory('performance', `⏱️  Completed: ${this.label} (${duration.toFixed(2)}ms)`)
    return duration
  }
}

/**
 * Conditional execution wrapper
 * Only executes the function if the specified category is enabled
 */
export function conditionalExec<T>(
  category: DebugCategory, 
  fn: () => T
): T | undefined {
  if (shouldDebug(category)) {
    return fn()
  }
  return undefined
}

/**
 * Async conditional execution wrapper
 * Only executes the async function if the specified category is enabled
 */
export async function conditionalExecAsync<T>(
  category: DebugCategory, 
  fn: () => Promise<T>
): Promise<T | undefined> {
  if (shouldDebug(category)) {
    return await fn()
  }
  return undefined
}

/**
 * Database query debug wrapper
 * Only logs if 'database' category is enabled
 */
export function debugQuery(query: string, params?: any[], duration?: number): void {
  if (shouldDebug('database')) {
    const message = duration 
      ? `🗄️  Query executed in ${duration}ms: ${query}`
      : `🗄️  Query: ${query}`
    
    debugCategory('database', message, { params })
  }
}

/**
 * API request debug wrapper
 * Only logs if 'api' category is enabled
 */
export function debugApiRequest(method: string, url: string, body?: any): void {
  if (shouldDebug('api')) {
    debugCategory('api', `📡 ${method.toUpperCase()} ${url}`, { body })
  }
}

/**
 * API response debug wrapper
 * Only logs if 'api' category is enabled
 */
export function debugApiResponse(url: string, status: number, duration?: number): void {
  if (shouldDebug('api')) {
    const message = duration 
      ? `📡 Response from ${url}: ${status} (${duration}ms)`
      : `📡 Response from ${url}: ${status}`
    
    debugCategory('api', message)
  }
}

/**
 * Queue/job debug wrapper
 * Only logs if 'queue' category is enabled
 */
export function debugQueue(jobType: string, jobId: string | number, data?: any): void {
  if (shouldDebug('queue')) {
    debugCategory('queue', `🔄 Job ${jobType} [${jobId}]`, { data })
  }
}

/**
 * Startup debug wrapper
 * Only logs if 'startup' category is enabled
 */
export function debugStartup(message: string, ...args: any[]): void {
  if (shouldDebug('startup')) {
    debugCategory('startup', `🚀 ${message}`, ...args)
  }
}

/**
 * Check if a specific debug category is enabled
 * Useful for conditional debug code blocks
 */
export function isDebugCategory(category: DebugCategory): boolean {
  return shouldDebug(category)
}

/**
 * Object inspection with conditional execution
 * Only inspects if the specified category is enabled
 */
export function debugInspect(category: DebugCategory, obj: any, label?: string): void {
  if (shouldDebug(category)) {
    const message = label ? `🔍 ${label}:` : '🔍 Object inspection:'
    debugCategory(category, message, obj)
  }
}

/**
 * Memory usage debug utility
 * Only executes if 'performance' category is enabled
 */
export function debugMemoryUsage(label?: string): void {
  if (shouldDebug('performance')) {
    const usage = process.memoryUsage()
    const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2)
    
    const message = label ? `💾 Memory usage - ${label}:` : '💾 Memory usage:'
    debugCategory('performance', message, {
      rss: `${formatMB(usage.rss)}MB`,
      heapUsed: `${formatMB(usage.heapUsed)}MB`,
      heapTotal: `${formatMB(usage.heapTotal)}MB`,
      external: `${formatMB(usage.external)}MB`
    })
  }
}
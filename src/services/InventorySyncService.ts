import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios'
import CircuitBreaker from 'opossum'
import { getRedisClient } from '../config/infrastructure'
import { logger } from '../config/logger'
import { config } from '../config/env'
import type Redis from 'ioredis'

// Extend axios config to include metadata
interface AxiosConfigWithMetadata extends InternalAxiosRequestConfig {
  metadata?: {
    startTime: number
  }
}

// Types for inventory data
export interface InventoryItem {
  variant_id: string
  sku: string
  quantity: number
  reserved_quantity: number
  is_available: boolean
  manage_inventory: boolean
  allow_backorder: boolean
  location_levels?: InventoryLocationLevel[]
  last_updated: Date
}

export interface InventoryLocationLevel {
  location_id: string
  stocked_quantity: number
  reserved_quantity: number
  incoming_quantity: number
}

export interface InventoryCheckResult {
  available: boolean
  quantity: number
  reserved_quantity: number
  can_backorder: boolean
  is_managed: boolean
  last_checked: Date
  location_breakdown?: InventoryLocationLevel[]
}

export interface InventorySyncStats {
  total_keys: number
  cache_hit_rate: number
  api_success_rate: number
  avg_response_time: number
  last_sync: Date
}

// Medusa API response types
interface MedusaVariantResponse {
  variant: {
    id: string
    sku: string
    manage_inventory: boolean
    allow_backorder: boolean
    inventory_quantity?: number
    inventory_items?: Array<{
      id: string
      sku: string
      requires_shipping: boolean
      location_levels?: InventoryLocationLevel[]
    }>
  }
}

interface MedusaInventoryItemResponse {
  inventory_item: {
    id: string
    sku: string
    requires_shipping: boolean
    location_levels?: InventoryLocationLevel[]
  }
}

/**
 * Service for real-time inventory synchronization between customer-backend and Medusa commerce backend
 * 
 * Architecture:
 * - Customer-backend queries Medusa backend via REST API
 * - Intelligent caching with Redis to reduce API load
 * - Circuit breaker pattern for resilience
 * - Batch operations for performance
 * - Comprehensive monitoring and alerting
 */
export class InventorySyncService {
  private readonly httpClient: AxiosInstance
  private readonly redis: Redis
  private readonly circuitBreaker: CircuitBreaker
  private readonly cachePrefix = 'inventory:v2:'
  private readonly cacheTTL = 30 // 30 seconds for inventory data
  private readonly batchCacheTTL = 15 // 15 seconds for batch operations
  private requestCount = 0
  private successCount = 0
  private totalResponseTime = 0

  constructor() {
    // Initialize HTTP client for Medusa backend
    this.httpClient = axios.create({
      baseURL: config.COMMERCE_BACKEND_URL,
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SideDecked-CustomerBackend/1.0',
        ...(config.COMMERCE_API_KEY && {
          'Authorization': `Bearer ${config.COMMERCE_API_KEY}`
        })
      }
    })

    // Add request/response interceptors for monitoring
    this.httpClient.interceptors.request.use((config: AxiosConfigWithMetadata) => {
      config.metadata = { startTime: Date.now() }
      this.requestCount++
      return config
    })

    this.httpClient.interceptors.response.use(
      (response) => {
        const config = response.config as AxiosConfigWithMetadata
        const responseTime = config.metadata ? Date.now() - config.metadata.startTime : 0
        this.totalResponseTime += responseTime
        this.successCount++
        
        logger.debug('Medusa API success', {
          url: response.config.url,
          method: response.config.method,
          status: response.status,
          responseTime: `${responseTime}ms`
        })
        
        return response
      },
      (error: AxiosError) => {
        const config = error.config as AxiosConfigWithMetadata | undefined
        const responseTime = config?.metadata?.startTime 
          ? Date.now() - config.metadata.startTime 
          : 0
        this.totalResponseTime += responseTime
        
        logger.error('Medusa API error', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          message: error.message,
          responseTime: `${responseTime}ms`
        })
        
        return Promise.reject(error)
      }
    )

    // Initialize Redis connection
    this.redis = getRedisClient()

    // Initialize circuit breaker for API resilience
    this.circuitBreaker = new CircuitBreaker(this.fetchInventoryFromMedusaRaw.bind(this), {
      timeout: 15000, // 15 second timeout
      errorThresholdPercentage: 50, // Open after 50% failure rate
      resetTimeout: 30000, // Try again after 30 seconds
      rollingCountTimeout: 60000, // 1 minute rolling window
      rollingCountBuckets: 10 // 10 buckets in rolling window
    })

    // Circuit breaker event handlers
    this.circuitBreaker.on('open', () => {
      logger.warn('Inventory sync circuit breaker opened - API calls suspended')
    })

    this.circuitBreaker.on('halfOpen', () => {
      logger.info('Inventory sync circuit breaker half-open - testing API')
    })

    this.circuitBreaker.on('close', () => {
      logger.info('Inventory sync circuit breaker closed - API calls resumed')
    })

    logger.info('InventorySyncService initialized', {
      commerceBackendUrl: config.COMMERCE_BACKEND_URL,
      cacheTTL: this.cacheTTL,
      hasApiKey: !!config.COMMERCE_API_KEY
    })
  }

  /**
   * Check inventory availability for a single product variant
   */
  async checkInventory(
    variantId: string, 
    useCache: boolean = true,
    includeLocationBreakdown: boolean = false
  ): Promise<InventoryCheckResult> {
    const cacheKey = `${this.cachePrefix}variant:${variantId}`
    
    try {
      // Try cache first if enabled
      if (useCache) {
        const cachedResult = await this.getCachedInventory(cacheKey)
        if (cachedResult) {
          logger.debug('Inventory cache hit', { variantId })
          return cachedResult
        }
      }

      // Fetch from Medusa backend through circuit breaker
      const inventoryData = await this.circuitBreaker.fire(variantId, includeLocationBreakdown) as InventoryItem
      
      const result: InventoryCheckResult = this.transformInventoryData(inventoryData)

      // Cache the result
      if (useCache) {
        await this.cacheInventoryResult(cacheKey, result, this.cacheTTL)
      }

      logger.debug('Inventory fetched from API', { 
        variantId, 
        available: result.available, 
        quantity: result.quantity 
      })

      return result
    } catch (error) {
      logger.error('Error checking inventory', error as Error, { variantId })
      
      // Try to return stale cache data if API fails
      if (useCache) {
        const staleResult = await this.getCachedInventory(cacheKey)
        if (staleResult) {
          logger.warn('Using stale inventory cache due to API error', { variantId })
          return staleResult
        }
      }

      // Fallback to unavailable
      return this.getFallbackInventoryResult()
    }
  }

  /**
   * Check inventory for multiple variants (optimized batch operation)
   */
  async checkMultipleInventory(
    variantIds: string[], 
    useCache: boolean = true,
    includeLocationBreakdown: boolean = false
  ): Promise<Map<string, InventoryCheckResult>> {
    if (variantIds.length === 0) {
      return new Map()
    }

    const results = new Map<string, InventoryCheckResult>()
    const uncachedVariants: string[] = []

    // Check cache for all variants if enabled
    if (useCache) {
      const cacheKeys = variantIds.map(id => `${this.cachePrefix}variant:${id}`)
      
      try {
        const cachedResults = await this.redis.mget(...cacheKeys)
        
        for (let i = 0; i < variantIds.length; i++) {
          const variantId = variantIds[i]
          const cachedData = cachedResults[i]
          
          if (cachedData) {
            try {
              const parsed = JSON.parse(cachedData)
              results.set(variantId, {
                ...parsed,
                last_checked: new Date(parsed.last_checked)
              })
              logger.debug('Batch inventory cache hit', { variantId })
            } catch (parseError) {
              logger.error('Error parsing cached inventory', parseError as Error, { variantId })
              uncachedVariants.push(variantId)
            }
          } else {
            uncachedVariants.push(variantId)
          }
        }
      } catch (error) {
        logger.error('Error reading batch cache', error as Error)
        uncachedVariants.push(...variantIds)
      }
    } else {
      uncachedVariants.push(...variantIds)
    }

    // Fetch uncached variants from Medusa API (batch operation)
    if (uncachedVariants.length > 0) {
      try {
        const batchResults = await this.fetchMultipleInventoryFromMedusa(
          uncachedVariants, 
          includeLocationBreakdown
        )
        
        // Process results and cache them
        const cacheOperations: Promise<void>[] = []
        
        for (const [variantId, inventoryData] of batchResults) {
          const result = this.transformInventoryData(inventoryData)
          results.set(variantId, result)
          
          if (useCache) {
            const cacheKey = `${this.cachePrefix}variant:${variantId}`
            cacheOperations.push(
              this.cacheInventoryResult(cacheKey, result, this.batchCacheTTL)
            )
          }
        }

        // Execute cache operations in parallel
        if (cacheOperations.length > 0) {
          await Promise.allSettled(cacheOperations)
        }

        logger.info('Batch inventory fetched from API', { 
          requestedCount: uncachedVariants.length,
          retrievedCount: batchResults.size 
        })
      } catch (error) {
        logger.error('Error fetching batch inventory from API', error as Error, {
          variantCount: uncachedVariants.length
        })
        
        // Add fallback results for failed variants
        for (const variantId of uncachedVariants) {
          if (!results.has(variantId)) {
            results.set(variantId, this.getFallbackInventoryResult())
          }
        }
      }
    }

    return results
  }

  /**
   * Invalidate cache after inventory changes (e.g., purchases, restocks)
   */
  async invalidateInventoryCache(variantIds: string[]): Promise<void> {
    if (variantIds.length === 0) return

    try {
      const cacheKeys = variantIds.map(id => `${this.cachePrefix}variant:${id}`)
      
      if (cacheKeys.length > 0) {
        await this.redis.del(...cacheKeys)
        logger.info('Inventory cache invalidated', { count: variantIds.length })
      }
    } catch (error) {
      logger.error('Error invalidating inventory cache', error as Error, {
        variantCount: variantIds.length
      })
    }
  }

  /**
   * Pre-warm cache for frequently accessed variants
   */
  async preWarmCache(variantIds: string[]): Promise<void> {
    logger.info('Pre-warming inventory cache', { count: variantIds.length })
    
    try {
      // Fetch without using cache, then cache the results
      await this.checkMultipleInventory(variantIds, false, false)
      logger.info('Inventory cache pre-warmed successfully', { count: variantIds.length })
    } catch (error) {
      logger.error('Error pre-warming inventory cache', error as Error)
    }
  }

  /**
   * Get service statistics for monitoring
   */
  async getServiceStats(): Promise<InventorySyncStats> {
    try {
      const pattern = `${this.cachePrefix}*`
      const keys = await this.redis.keys(pattern)
      
      const hitRate = this.requestCount > 0 
        ? ((this.requestCount - this.successCount) / this.requestCount) * 100
        : 0

      const avgResponseTime = this.requestCount > 0 
        ? this.totalResponseTime / this.requestCount 
        : 0

      const successRate = this.requestCount > 0 
        ? (this.successCount / this.requestCount) * 100 
        : 100

      return {
        total_keys: keys.length,
        cache_hit_rate: Math.round(hitRate * 100) / 100,
        api_success_rate: Math.round(successRate * 100) / 100,
        avg_response_time: Math.round(avgResponseTime * 100) / 100,
        last_sync: new Date()
      }
    } catch (error) {
      logger.error('Error getting service stats', error as Error)
      return {
        total_keys: 0,
        cache_hit_rate: 0,
        api_success_rate: 0,
        avg_response_time: 0,
        last_sync: new Date()
      }
    }
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{
    healthy: boolean
    redis_connected: boolean
    api_accessible: boolean
    circuit_breaker_state: string
    last_error?: string
  }> {
    const health = {
      healthy: false,
      redis_connected: false,
      api_accessible: false,
      circuit_breaker_state: this.circuitBreaker.opened ? 'open' : this.circuitBreaker.halfOpen ? 'half-open' : 'closed',
      last_error: undefined as string | undefined
    }

    try {
      // Check Redis connection
      await this.redis.ping()
      health.redis_connected = true
      
      // Check API accessibility with a lightweight test
      const testResponse = await this.httpClient.get('/admin/orders?limit=1')
      health.api_accessible = testResponse.status === 200
      
      health.healthy = health.redis_connected && health.api_accessible
      
    } catch (error) {
      health.last_error = (error as Error).message
      logger.error('Inventory sync health check failed', error as Error)
    }

    return health
  }

  // Private helper methods

  private async getCachedInventory(cacheKey: string): Promise<InventoryCheckResult | null> {
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached)
        return {
          ...parsed,
          last_checked: new Date(parsed.last_checked)
        }
      }
      return null
    } catch (error) {
      logger.error('Error getting cached inventory', error as Error, { cacheKey })
      return null
    }
  }

  private async cacheInventoryResult(
    cacheKey: string, 
    result: InventoryCheckResult, 
    ttl: number
  ): Promise<void> {
    try {
      await this.redis.setex(cacheKey, ttl, JSON.stringify(result))
    } catch (error) {
      logger.error('Error caching inventory result', error as Error, { cacheKey })
    }
  }

  private async fetchInventoryFromMedusaRaw(
    variantId: string, 
    includeLocationBreakdown: boolean
  ): Promise<InventoryItem> {
    // Try admin endpoint first for detailed data
    try {
      const response = await this.httpClient.get<MedusaVariantResponse>(
        `/admin/products/variants/${variantId}`
      )
      
      return this.transformMedusaVariantToInventoryItem(response.data.variant)
    } catch (adminError) {
      // Fallback to store endpoint if admin fails
      try {
        const storeResponse = await this.httpClient.get(
          `/store/products/variants/${variantId}`
        )
        
        return this.transformMedusaVariantToInventoryItem(storeResponse.data.variant)
      } catch (storeError) {
        logger.error('Both admin and store API calls failed for variant', storeError as Error, {
          variantId,
          adminError: (adminError as Error).message
        })
        throw storeError
      }
    }
  }

  private async fetchMultipleInventoryFromMedusa(
    variantIds: string[],
    includeLocationBreakdown: boolean
  ): Promise<Map<string, InventoryItem>> {
    const results = new Map<string, InventoryItem>()
    
    // Medusa doesn't have a native batch variant endpoint, so we'll use concurrent requests
    // Limited concurrency to avoid overwhelming the API
    const batchSize = 5
    const batches: string[][] = []
    
    for (let i = 0; i < variantIds.length; i += batchSize) {
      batches.push(variantIds.slice(i, i + batchSize))
    }

    for (const batch of batches) {
      const promises = batch.map(async (variantId) => {
        try {
          const inventoryData = await this.fetchInventoryFromMedusaRaw(
            variantId, 
            includeLocationBreakdown
          )
          return { variantId, inventoryData }
        } catch (error) {
          logger.error('Error fetching individual variant in batch', error as Error, { variantId })
          return null
        }
      })

      const batchResults = await Promise.allSettled(promises)
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          const { variantId, inventoryData } = result.value
          results.set(variantId, inventoryData)
        }
      }
    }

    return results
  }

  private transformMedusaVariantToInventoryItem(variant: any): InventoryItem {
    const quantity = variant.inventory_quantity || 0
    const reserved = 0 // TODO: Get from inventory items if available
    
    return {
      variant_id: variant.id,
      sku: variant.sku || `var_${variant.id}`,
      quantity,
      reserved_quantity: reserved,
      is_available: quantity > reserved,
      manage_inventory: variant.manage_inventory !== false,
      allow_backorder: variant.allow_backorder === true,
      location_levels: variant.inventory_items?.[0]?.location_levels || [],
      last_updated: new Date()
    }
  }

  private transformInventoryData(inventoryData: InventoryItem): InventoryCheckResult {
    const availableQuantity = Math.max(0, inventoryData.quantity - inventoryData.reserved_quantity)
    
    return {
      available: availableQuantity > 0 || inventoryData.allow_backorder,
      quantity: availableQuantity,
      reserved_quantity: inventoryData.reserved_quantity,
      can_backorder: inventoryData.allow_backorder,
      is_managed: inventoryData.manage_inventory,
      last_checked: new Date(),
      location_breakdown: inventoryData.location_levels
    }
  }

  private getFallbackInventoryResult(): InventoryCheckResult {
    return {
      available: false,
      quantity: 0,
      reserved_quantity: 0,
      can_backorder: false,
      is_managed: true,
      last_checked: new Date()
    }
  }
}
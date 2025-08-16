import { PriceAlertService } from './PriceAlertService'
import { PriceHistoryService } from './PriceHistoryService'
import { logger } from '../config/logger'

interface ScheduledJob {
  name: string
  interval: number // milliseconds
  lastRun?: Date
  nextRun?: Date
  running: boolean
  enabled: boolean
  handler: () => Promise<void>
}

export class JobScheduler {
  private jobs: Map<string, ScheduledJob> = new Map()
  private timers: Map<string, NodeJS.Timeout> = new Map()
  private priceAlertService: PriceAlertService
  private priceHistoryService: PriceHistoryService

  constructor() {
    this.priceAlertService = new PriceAlertService()
    this.priceHistoryService = new PriceHistoryService()
    this.setupDefaultJobs()
  }

  /**
   * Setup default background jobs
   */
  private setupDefaultJobs() {
    // Price alert checking job - every 15 minutes
    this.addJob('price-alerts-check', 15 * 60 * 1000, async () => {
      logger.info('Starting price alerts check job')
      try {
        const result = await this.priceAlertService.checkPriceAlerts()
        logger.info('Price alerts check completed', {
          alerts_triggered: result.alerts_triggered,
          notifications_sent: result.notifications_sent,
          errors: result.errors.length
        })
      } catch (error) {
        logger.error('Price alerts check job failed', error as Error)
      }
    })

    // Cleanup expired alerts job - every 6 hours
    this.addJob('cleanup-expired-alerts', 6 * 60 * 60 * 1000, async () => {
      logger.info('Starting cleanup expired alerts job')
      try {
        const expiredCount = await this.priceAlertService.cleanupExpiredAlerts()
        logger.info(`Cleanup expired alerts completed: ${expiredCount} alerts expired`)
      } catch (error) {
        logger.error('Cleanup expired alerts job failed', error as Error)
      }
    })

    // Update wishlist item prices - every 30 minutes
    this.addJob('update-wishlist-prices', 30 * 60 * 1000, async () => {
      logger.info('Starting update wishlist prices job')
      try {
        await this.updateWishlistPrices()
        logger.info('Update wishlist prices completed')
      } catch (error) {
        logger.error('Update wishlist prices job failed', error as Error)
      }
    })

    // Daily price aggregation - runs at 2 AM
    this.addJob('daily-price-aggregation', 24 * 60 * 60 * 1000, async () => {
      logger.info('Starting daily price aggregation job')
      try {
        await this.aggregateDailyPrices()
        logger.info('Daily price aggregation completed')
      } catch (error) {
        logger.error('Daily price aggregation job failed', error as Error)
      }
    })

    // Weekly price aggregation - runs on Sundays
    this.addJob('weekly-price-aggregation', 7 * 24 * 60 * 60 * 1000, async () => {
      logger.info('Starting weekly price aggregation job')
      try {
        await this.aggregateWeeklyPrices()
        logger.info('Weekly price aggregation completed')
      } catch (error) {
        logger.error('Weekly price aggregation job failed', error as Error)
      }
    })

    // Cleanup old price history - every 7 days
    this.addJob('cleanup-price-history', 7 * 24 * 60 * 60 * 1000, async () => {
      logger.info('Starting price history cleanup job')
      try {
        const deletedRecords = await this.priceHistoryService.cleanupOldRecords(365)
        logger.info(`Price history cleanup completed: ${deletedRecords} records deleted`)
      } catch (error) {
        logger.error('Price history cleanup job failed', error as Error)
      }
    })
  }

  /**
   * Add a scheduled job
   */
  addJob(name: string, intervalMs: number, handler: () => Promise<void>, enabled: boolean = true) {
    const job: ScheduledJob = {
      name,
      interval: intervalMs,
      running: false,
      enabled,
      handler,
      nextRun: new Date(Date.now() + intervalMs)
    }

    this.jobs.set(name, job)

    if (enabled) {
      this.scheduleJob(name)
    }

    logger.info(`Added job: ${name} (interval: ${intervalMs}ms, enabled: ${enabled})`)
  }

  /**
   * Schedule a job to run
   */
  private scheduleJob(name: string) {
    const job = this.jobs.get(name)
    if (!job || !job.enabled) return

    // Clear existing timer if any
    const existingTimer = this.timers.get(name)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Schedule next run
    const timer = setTimeout(async () => {
      await this.runJob(name)
    }, job.interval)

    this.timers.set(name, timer)
    job.nextRun = new Date(Date.now() + job.interval)
  }

  /**
   * Run a specific job
   */
  private async runJob(name: string) {
    const job = this.jobs.get(name)
    if (!job || job.running) return

    job.running = true
    job.lastRun = new Date()

    try {
      await job.handler()
    } catch (error) {
      logger.error(`Job ${name} failed`, error as Error)
    } finally {
      job.running = false
      
      // Schedule next run if job is still enabled
      if (job.enabled) {
        this.scheduleJob(name)
      }
    }
  }

  /**
   * Enable a job
   */
  enableJob(name: string) {
    const job = this.jobs.get(name)
    if (!job) {
      logger.warn(`Job ${name} not found`)
      return
    }

    job.enabled = true
    this.scheduleJob(name)
    logger.info(`Enabled job: ${name}`)
  }

  /**
   * Disable a job
   */
  disableJob(name: string) {
    const job = this.jobs.get(name)
    if (!job) {
      logger.warn(`Job ${name} not found`)
      return
    }

    job.enabled = false
    
    const timer = this.timers.get(name)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(name)
    }

    logger.info(`Disabled job: ${name}`)
  }

  /**
   * Get job status
   */
  getJobStatus(name: string) {
    const job = this.jobs.get(name)
    if (!job) return null

    return {
      name: job.name,
      enabled: job.enabled,
      running: job.running,
      interval: job.interval,
      lastRun: job.lastRun,
      nextRun: job.nextRun
    }
  }

  /**
   * Get all jobs status
   */
  getAllJobsStatus() {
    const status: any[] = []
    
    for (const [name, job] of this.jobs) {
      status.push({
        name: job.name,
        enabled: job.enabled,
        running: job.running,
        interval: job.interval,
        intervalHuman: this.formatInterval(job.interval),
        lastRun: job.lastRun,
        nextRun: job.nextRun
      })
    }

    return status
  }

  /**
   * Manually trigger a job
   */
  async triggerJob(name: string) {
    const job = this.jobs.get(name)
    if (!job) {
      throw new Error(`Job ${name} not found`)
    }

    if (job.running) {
      throw new Error(`Job ${name} is already running`)
    }

    logger.info(`Manually triggering job: ${name}`)
    await this.runJob(name)
  }

  /**
   * Start the job scheduler
   */
  start() {
    logger.info('Starting job scheduler')
    
    for (const [name, job] of this.jobs) {
      if (job.enabled) {
        this.scheduleJob(name)
      }
    }

    logger.info(`Job scheduler started with ${this.jobs.size} jobs`)
  }

  /**
   * Stop the job scheduler
   */
  stop() {
    logger.info('Stopping job scheduler')
    
    for (const [name, timer] of this.timers) {
      clearTimeout(timer)
    }
    
    this.timers.clear()
    logger.info('Job scheduler stopped')
  }

  /**
   * Update wishlist item prices
   * This job updates current prices for all wishlist items
   */
  private async updateWishlistPrices() {
    try {
      // This would be implemented to batch update wishlist item prices
      // For now, it's a placeholder
      logger.info('Updating wishlist item prices...')
      
      // TODO: Implement batch price updates for wishlist items
      // 1. Get unique catalog SKUs from all wishlist items
      // 2. Fetch current prices for those SKUs
      // 3. Update wishlist_items table with new prices
      // 4. Update wishlist total_value
      
    } catch (error) {
      logger.error('Error updating wishlist prices', error as Error)
      throw error
    }
  }

  /**
   * Aggregate daily price data from market prices
   */
  private async aggregateDailyPrices() {
    try {
      logger.info('Aggregating daily prices from market data...')
      
      // Get unique catalog SKUs with recent market data
      const skusWithPrices = await this.getSkusWithRecentMarketData()
      
      let processedCount = 0
      const batchSize = 50
      
      for (let i = 0; i < skusWithPrices.length; i += batchSize) {
        const batch = skusWithPrices.slice(i, i + batchSize)
        
        await Promise.all(batch.map(async (sku) => {
          try {
            // Aggregate prices for different conditions and languages
            const conditions = ['NM', 'LP', 'MP', 'HP']
            const languages = ['EN', 'JP', 'DE', 'FR', 'ES', 'IT']
            
            for (const condition of conditions) {
              for (const language of languages) {
                try {
                  await this.priceHistoryService.aggregateMarketPrices(
                    sku.catalog_sku,
                    condition,
                    language,
                    'daily'
                  )
                } catch (error) {
                  // Skip if no data for this combination
                  if (!(error as Error).message.includes('No market prices found')) {
                    throw error
                  }
                }
              }
            }
            
            processedCount++
          } catch (error) {
            logger.error(`Error aggregating daily prices for SKU ${sku.catalog_sku}`, error as Error)
          }
        }))
        
        logger.info(`Daily price aggregation progress: ${Math.min(i + batchSize, skusWithPrices.length)}/${skusWithPrices.length}`)
      }
      
      logger.info(`Daily price aggregation completed: ${processedCount} SKUs processed`)
    } catch (error) {
      logger.error('Error in daily price aggregation', error as Error)
      throw error
    }
  }

  /**
   * Aggregate weekly price data from daily records
   */
  private async aggregateWeeklyPrices() {
    try {
      logger.info('Aggregating weekly prices from daily data...')
      
      // Get SKUs with daily price history from last week
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 7)
      
      const skusWithHistory = await this.getSkusWithPriceHistory(startDate, 'daily')
      
      let processedCount = 0
      
      for (const sku of skusWithHistory) {
        try {
          // Create weekly aggregation by averaging daily records
          await this.createWeeklyAggregation(sku.catalog_sku, sku.condition, sku.language)
          processedCount++
        } catch (error) {
          logger.error(`Error creating weekly aggregation for SKU ${sku.catalog_sku}`, error as Error)
        }
      }
      
      logger.info(`Weekly price aggregation completed: ${processedCount} SKUs processed`)
    } catch (error) {
      logger.error('Error in weekly price aggregation', error as Error)
      throw error
    }
  }

  /**
   * Get catalog SKUs with recent market data
   */
  private async getSkusWithRecentMarketData(): Promise<{ catalog_sku: string }[]> {
    try {
      const { AppDataSource } = await import('../config/database')
      
      const result = await AppDataSource.query(`
        SELECT DISTINCT catalog_sku
        FROM market_prices 
        WHERE last_scraped >= NOW() - INTERVAL '24 hours'
        AND is_available = true
        ORDER BY catalog_sku
      `)
      
      return result
    } catch (error) {
      logger.error('Error getting SKUs with recent market data', error as Error)
      return []
    }
  }

  /**
   * Get catalog SKUs with price history
   */
  private async getSkusWithPriceHistory(
    since: Date, 
    aggregationPeriod: string
  ): Promise<{ catalog_sku: string, condition: string, language: string }[]> {
    try {
      const { AppDataSource } = await import('../config/database')
      
      const result = await AppDataSource.query(`
        SELECT DISTINCT catalog_sku, condition, language
        FROM price_history 
        WHERE recorded_at >= $1
        AND aggregation_period = $2
        ORDER BY catalog_sku, condition, language
      `, [since, aggregationPeriod])
      
      return result
    } catch (error) {
      logger.error('Error getting SKUs with price history', error as Error)
      return []
    }
  }

  /**
   * Create weekly aggregation from daily records
   */
  private async createWeeklyAggregation(
    catalogSku: string, 
    condition: string, 
    language: string
  ): Promise<void> {
    try {
      const { AppDataSource } = await import('../config/database')
      
      // Get daily records from last week
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      
      const dailyRecords = await AppDataSource.query(`
        SELECT * FROM price_history
        WHERE catalog_sku = $1 
        AND condition = $2 
        AND language = $3
        AND aggregation_period = 'daily'
        AND recorded_at >= $4
        ORDER BY recorded_at DESC
      `, [catalogSku, condition, language, weekAgo])
      
      if (dailyRecords.length === 0) {
        return
      }
      
      // Calculate weekly averages
      const weeklyData = {
        lowest_price: Math.min(...dailyRecords.map((r: any) => r.lowest_price)),
        highest_price: Math.max(...dailyRecords.map((r: any) => r.highest_price)),
        average_price: dailyRecords.reduce((sum: number, r: any) => sum + Number(r.average_price), 0) / dailyRecords.length,
        market_price: dailyRecords.reduce((sum: number, r: any) => sum + Number(r.market_price), 0) / dailyRecords.length,
        listings_count: Math.round(dailyRecords.reduce((sum: number, r: any) => sum + r.listings_count, 0) / dailyRecords.length),
        in_stock_count: Math.round(dailyRecords.reduce((sum: number, r: any) => sum + r.in_stock_count, 0) / dailyRecords.length)
      }
      
      // Create or update weekly record
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()) // Start of week (Sunday)
      weekStart.setHours(0, 0, 0, 0)
      
      await AppDataSource.query(`
        INSERT INTO price_history (
          catalog_sku, condition, language, lowest_price, average_price, 
          highest_price, market_price, listings_count, in_stock_count,
          price_sources, aggregation_period, recorded_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'weekly', $11)
        ON CONFLICT (catalog_sku, condition, language, aggregation_period, recorded_at)
        DO UPDATE SET
          lowest_price = EXCLUDED.lowest_price,
          average_price = EXCLUDED.average_price,
          highest_price = EXCLUDED.highest_price,
          market_price = EXCLUDED.market_price,
          listings_count = EXCLUDED.listings_count,
          in_stock_count = EXCLUDED.in_stock_count,
          updated_at = NOW()
      `, [
        catalogSku, condition, language,
        weeklyData.lowest_price, weeklyData.average_price, weeklyData.highest_price,
        weeklyData.market_price, weeklyData.listings_count, weeklyData.in_stock_count,
        JSON.stringify([]), // Empty price sources for aggregated data
        weekStart
      ])
      
    } catch (error) {
      logger.error(`Error creating weekly aggregation for ${catalogSku}`, error as Error)
      throw error
    }
  }

  /**
   * Format interval in human readable format
   */
  private formatInterval(intervalMs: number): string {
    const seconds = intervalMs / 1000
    const minutes = seconds / 60
    const hours = minutes / 60
    const days = hours / 24

    if (days >= 1) {
      return `${Math.floor(days)}d ${Math.floor(hours % 24)}h`
    } else if (hours >= 1) {
      return `${Math.floor(hours)}h ${Math.floor(minutes % 60)}m`
    } else if (minutes >= 1) {
      return `${Math.floor(minutes)}m ${Math.floor(seconds % 60)}s`
    } else {
      return `${Math.floor(seconds)}s`
    }
  }
}

// Export singleton instance
export const jobScheduler = new JobScheduler()
import { Repository } from 'typeorm'
import { AppDataSource } from '../config/database'
import { MarketPrice } from '../entities/MarketPrice'
import { PriceHistory } from '../entities/PriceHistory'
import { logger } from '../config/logger'

export interface MarketDataSource {
  name: string
  priority: number // Higher priority = more trusted
  rateLimit: number // Requests per minute
  enabled: boolean
}

export interface ScrapingResult {
  source: string
  catalog_sku: string
  prices_collected: number
  errors: string[]
  processing_time: number
}

export interface MarketSummary {
  catalog_sku: string
  condition: string
  language: string
  current_market_price: number
  lowest_available: number
  highest_available: number
  average_price: number
  price_trend_7d: number
  price_trend_30d: number
  volatility_score: number
  liquidity_score: number
  confidence_score: number
  total_listings: number
  in_stock_listings: number
  sources_count: number
  last_updated: Date
}

export interface MarketInsights {
  hot_cards: Array<{
    catalog_sku: string
    card_name: string
    game_name: string
    price_change_7d: number
    volume_change_7d: number
    market_cap_change: number
  }>
  trending_up: Array<{
    catalog_sku: string
    card_name: string
    price_change: number
    confidence: number
  }>
  trending_down: Array<{
    catalog_sku: string
    card_name: string
    price_change: number
    confidence: number
  }>
  opportunities: Array<{
    catalog_sku: string
    card_name: string
    reason: string
    potential_upside: number
    risk_level: 'low' | 'medium' | 'high'
  }>
}

export class MarketDataService {
  private marketPriceRepo: Repository<MarketPrice>
  private priceHistoryRepo: Repository<PriceHistory>
  
  // Configuration for different data sources
  private dataSources: MarketDataSource[] = [
    { name: 'tcgplayer', priority: 95, rateLimit: 100, enabled: true },
    { name: 'cardmarket', priority: 90, rateLimit: 60, enabled: true },
    { name: 'ebay', priority: 70, rateLimit: 30, enabled: true },
    { name: 'amazon', priority: 60, rateLimit: 20, enabled: false },
    { name: 'comc', priority: 80, rateLimit: 40, enabled: true },
    { name: 'sportlots', priority: 50, rateLimit: 15, enabled: false }
  ]

  constructor() {
    this.marketPriceRepo = AppDataSource.getRepository(MarketPrice)
    this.priceHistoryRepo = AppDataSource.getRepository(PriceHistory)
  }

  /**
   * Collect market data for a specific catalog SKU from all enabled sources
   */
  async collectMarketData(catalogSku: string): Promise<ScrapingResult[]> {
    const results: ScrapingResult[] = []
    
    const enabledSources = this.dataSources.filter(source => source.enabled)
    
    for (const source of enabledSources) {
      const startTime = Date.now()
      
      try {
        logger.info(`Collecting market data from ${source.name} for SKU ${catalogSku}`)
        
        const scrapingResult = await this.scrapeDataFromSource(source.name, catalogSku)
        
        results.push({
          source: source.name,
          catalog_sku: catalogSku,
          prices_collected: scrapingResult.prices_collected,
          errors: scrapingResult.errors,
          processing_time: Date.now() - startTime
        })
        
        logger.info(`Collected ${scrapingResult.prices_collected} prices from ${source.name}`)
        
        // Respect rate limits
        await this.sleep(60000 / source.rateLimit) // Convert rate limit to delay
        
      } catch (error) {
        logger.error(`Error collecting data from ${source.name}`, error as Error)
        results.push({
          source: source.name,
          catalog_sku: catalogSku,
          prices_collected: 0,
          errors: [(error as Error).message],
          processing_time: Date.now() - startTime
        })
      }
    }
    
    return results
  }

  /**
   * Batch collect market data for multiple SKUs
   */
  async batchCollectMarketData(catalogSkus: string[], maxConcurrent: number = 3): Promise<ScrapingResult[]> {
    const allResults: ScrapingResult[] = []
    
    // Process SKUs in batches to avoid overwhelming sources
    for (let i = 0; i < catalogSkus.length; i += maxConcurrent) {
      const batch = catalogSkus.slice(i, i + maxConcurrent)
      
      const batchPromises = batch.map(sku => this.collectMarketData(sku))
      const batchResults = await Promise.all(batchPromises)
      
      allResults.push(...batchResults.flat())
      
      logger.info(`Processed batch ${Math.floor(i / maxConcurrent) + 1}/${Math.ceil(catalogSkus.length / maxConcurrent)}`)
      
      // Delay between batches to be respectful to data sources
      if (i + maxConcurrent < catalogSkus.length) {
        await this.sleep(5000) // 5 second delay between batches
      }
    }
    
    return allResults
  }

  /**
   * Generate market summary for a catalog SKU
   */
  async generateMarketSummary(
    catalogSku: string,
    condition: string = 'NM',
    language: string = 'EN'
  ): Promise<MarketSummary | null> {
    try {
      // Get current market prices
      const currentPrices = await this.marketPriceRepo.find({
        where: {
          catalog_sku: catalogSku,
          condition,
          language,
          is_available: true
        },
        order: { last_scraped: 'DESC' }
      })

      if (currentPrices.length === 0) {
        return null
      }

      // Get price history for trends
      const priceHistory = await this.priceHistoryRepo.find({
        where: { catalog_sku: catalogSku, condition, language },
        order: { recorded_at: 'DESC' },
        take: 30 // Last 30 days
      })

      // Calculate current metrics
      const prices = currentPrices.map(p => p.price_per_unit)
      const lowest_available = Math.min(...prices)
      const highest_available = Math.max(...prices)
      const average_price = prices.reduce((sum, p) => sum + p, 0) / prices.length

      // Calculate market price (weighted by source trust and recency)
      const current_market_price = this.calculateWeightedMarketPrice(currentPrices)

      // Calculate trends
      const price_trend_7d = this.calculatePriceTrend(priceHistory, 7)
      const price_trend_30d = this.calculatePriceTrend(priceHistory, 30)

      // Calculate scores
      const volatility_score = this.calculateVolatilityScore(priceHistory)
      const liquidity_score = this.calculateLiquidityScore(currentPrices)
      const confidence_score = this.calculateConfidenceScore(currentPrices, priceHistory)

      // Count metrics
      const total_listings = currentPrices.length
      const in_stock_listings = currentPrices.filter(p => p.stock_quantity && p.stock_quantity > 0).length
      const sources_count = new Set(currentPrices.map(p => p.source)).size

      return {
        catalog_sku: catalogSku,
        condition,
        language,
        current_market_price,
        lowest_available,
        highest_available,
        average_price,
        price_trend_7d,
        price_trend_30d,
        volatility_score,
        liquidity_score,
        confidence_score,
        total_listings,
        in_stock_listings,
        sources_count,
        last_updated: new Date()
      }

    } catch (error) {
      logger.error(`Error generating market summary for ${catalogSku}`, error as Error)
      return null
    }
  }

  /**
   * Generate market insights and trends
   */
  async generateMarketInsights(gameFilter?: string, limit: number = 20): Promise<MarketInsights> {
    try {
      // This would be a complex query analyzing price movements, volume changes, etc.
      // For now, returning mock structure
      
      const hot_cards = await this.getHotCards(gameFilter, limit)
      const trending_up = await this.getTrendingUpCards(gameFilter, limit)
      const trending_down = await this.getTrendingDownCards(gameFilter, limit)
      const opportunities = await this.getInvestmentOpportunities(gameFilter, limit)

      return {
        hot_cards,
        trending_up,
        trending_down,
        opportunities
      }

    } catch (error) {
      logger.error('Error generating market insights', error as Error)
      return {
        hot_cards: [],
        trending_up: [],
        trending_down: [],
        opportunities: []
      }
    }
  }

  /**
   * Clean and normalize market data
   */
  async cleanMarketData(): Promise<{
    stale_records_removed: number
    duplicate_records_removed: number
    invalid_records_fixed: number
  }> {
    try {
      logger.info('Starting market data cleanup...')

      // Remove stale records (older than 48 hours)
      const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000)
      const staleResult = await this.marketPriceRepo
        .createQueryBuilder()
        .delete()
        .where('last_scraped < :threshold', { threshold: staleThreshold })
        .execute()

      // Remove duplicate records (same source, seller, and SKU)
      const duplicatesQuery = `
        DELETE FROM market_prices a USING market_prices b 
        WHERE a.id > b.id 
        AND a.catalog_sku = b.catalog_sku 
        AND a.source = b.source 
        AND a.seller_id = b.seller_id 
        AND a.condition = b.condition 
        AND a.language = b.language
      `
      const duplicateResult = await AppDataSource.query(duplicatesQuery)

      // Fix invalid prices (negative, zero, or unreasonably high)
      const invalidPricesResult = await this.marketPriceRepo
        .createQueryBuilder()
        .update()
        .set({ is_available: false })
        .where('price <= 0 OR price > 10000') // Assume prices over $10,000 are invalid
        .execute()

      const result = {
        stale_records_removed: staleResult.affected || 0,
        duplicate_records_removed: duplicateResult[1] || 0,
        invalid_records_fixed: invalidPricesResult.affected || 0
      }

      logger.info('Market data cleanup completed', result)
      return result

    } catch (error) {
      logger.error('Error cleaning market data', error as Error)
      return {
        stale_records_removed: 0,
        duplicate_records_removed: 0,
        invalid_records_fixed: 0
      }
    }
  }

  /**
   * Get market health metrics
   */
  async getMarketHealth(): Promise<{
    total_active_listings: number
    total_sources: number
    average_data_freshness_hours: number
    price_coverage_percentage: number
    data_quality_score: number
    last_update: Date
  }> {
    try {
      const [
        totalActiveListings,
        totalSources,
        avgFreshness,
        coverageStats
      ] = await Promise.all([
        this.marketPriceRepo.count({ where: { is_available: true } }),
        this.marketPriceRepo.query('SELECT COUNT(DISTINCT source) as count FROM market_prices WHERE is_available = true'),
        this.marketPriceRepo.query(`
          SELECT AVG(EXTRACT(EPOCH FROM (NOW() - last_scraped)) / 3600) as avg_hours 
          FROM market_prices 
          WHERE is_available = true
        `),
        this.marketPriceRepo.query(`
          SELECT 
            COUNT(DISTINCT catalog_sku) as skus_with_prices,
            (SELECT COUNT(*) FROM catalog_skus WHERE is_active = true) as total_active_skus
        `)
      ])

      const avgFreshnessHours = parseFloat(avgFreshness[0]?.avg_hours || '0')
      const coveragePercentage = coverageStats[0].total_active_skus > 0 
        ? (coverageStats[0].skus_with_prices / coverageStats[0].total_active_skus) * 100 
        : 0

      // Calculate data quality score (0-100)
      const freshnessScore = Math.max(0, 100 - (avgFreshnessHours * 2)) // Penalty for stale data
      const coverageScore = coveragePercentage
      const sourceScore = Math.min(100, (totalSources[0].count / 5) * 100) // Score based on source diversity
      const data_quality_score = (freshnessScore + coverageScore + sourceScore) / 3

      return {
        total_active_listings: totalActiveListings,
        total_sources: totalSources[0].count,
        average_data_freshness_hours: avgFreshnessHours,
        price_coverage_percentage: coveragePercentage,
        data_quality_score: Math.round(data_quality_score),
        last_update: new Date()
      }

    } catch (error) {
      logger.error('Error getting market health', error as Error)
      return {
        total_active_listings: 0,
        total_sources: 0,
        average_data_freshness_hours: 0,
        price_coverage_percentage: 0,
        data_quality_score: 0,
        last_update: new Date()
      }
    }
  }

  // Private helper methods

  private async scrapeDataFromSource(source: string, catalogSku: string): Promise<{
    prices_collected: number
    errors: string[]
  }> {
    // This would implement actual scraping logic for each source
    // For now, returning mock data
    
    switch (source) {
      case 'tcgplayer':
        return await this.scrapeTCGPlayer(catalogSku)
      case 'cardmarket':
        return await this.scrapeCardmarket(catalogSku)
      case 'ebay':
        return await this.scrapeEbay(catalogSku)
      default:
        return { prices_collected: 0, errors: ['Source not implemented'] }
    }
  }

  private async scrapeTCGPlayer(catalogSku: string): Promise<{ prices_collected: number, errors: string[] }> {
    // TODO: Implement TCGPlayer scraping
    // This would use their API if available, or web scraping
    logger.info(`Would scrape TCGPlayer for SKU ${catalogSku}`)
    return { prices_collected: 0, errors: ['TCGPlayer scraping not implemented'] }
  }

  private async scrapeCardmarket(catalogSku: string): Promise<{ prices_collected: number, errors: string[] }> {
    // TODO: Implement Cardmarket scraping
    logger.info(`Would scrape Cardmarket for SKU ${catalogSku}`)
    return { prices_collected: 0, errors: ['Cardmarket scraping not implemented'] }
  }

  private async scrapeEbay(catalogSku: string): Promise<{ prices_collected: number, errors: string[] }> {
    // TODO: Implement eBay scraping
    logger.info(`Would scrape eBay for SKU ${catalogSku}`)
    return { prices_collected: 0, errors: ['eBay scraping not implemented'] }
  }

  private calculateWeightedMarketPrice(prices: MarketPrice[]): number {
    if (prices.length === 0) return 0

    let totalWeight = 0
    let weightedSum = 0

    for (const price of prices) {
      // Calculate weight based on source priority, seller trust, and data freshness
      const sourceData = this.dataSources.find(s => s.name === price.source)
      const sourcePriority = sourceData?.priority || 50

      let weight = sourcePriority / 100 // Base weight from source priority
      
      // Adjust for seller trustworthiness
      switch (price.seller_trustworthiness) {
        case 'high': weight *= 1.2; break
        case 'medium': weight *= 1.0; break
        case 'low': weight *= 0.8; break
        case 'unknown': weight *= 0.9; break
      }

      // Adjust for data freshness (newer = higher weight)
      const hoursOld = (Date.now() - price.last_scraped.getTime()) / (1000 * 60 * 60)
      weight *= Math.max(0.1, 1 - (hoursOld / 24)) // Decay over 24 hours

      // Adjust for stock availability
      if (price.stock_quantity && price.stock_quantity > 0) {
        weight *= 1.1
      }

      weightedSum += price.price_per_unit * weight
      totalWeight += weight
    }

    return totalWeight > 0 ? weightedSum / totalWeight : prices[0].price_per_unit
  }

  private calculatePriceTrend(history: PriceHistory[], days: number): number {
    if (history.length < 2) return 0

    const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000))
    const recentHistory = history.filter(h => h.recorded_at >= cutoffDate)

    if (recentHistory.length < 2) return 0

    const latest = recentHistory[0]
    const oldest = recentHistory[recentHistory.length - 1]

    return ((latest.market_price - oldest.market_price) / oldest.market_price) * 100
  }

  private calculateVolatilityScore(history: PriceHistory[]): number {
    if (history.length < 3) return 0

    const prices = history.map(h => h.market_price)
    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length
    const standardDeviation = Math.sqrt(variance)

    return (standardDeviation / mean) * 100 // Coefficient of variation as percentage
  }

  private calculateLiquidityScore(prices: MarketPrice[]): number {
    if (prices.length === 0) return 0

    const inStockCount = prices.filter(p => p.stock_quantity && p.stock_quantity > 0).length
    const sourceCount = new Set(prices.map(p => p.source)).size
    const totalStock = prices.reduce((sum, p) => sum + (p.stock_quantity || 0), 0)

    // Score based on availability, source diversity, and total stock
    const availabilityScore = (inStockCount / prices.length) * 40
    const diversityScore = Math.min(sourceCount * 10, 30)
    const stockScore = Math.min(totalStock * 2, 30)

    return availabilityScore + diversityScore + stockScore
  }

  private calculateConfidenceScore(prices: MarketPrice[], history: PriceHistory[]): number {
    if (prices.length === 0) return 0

    // Base score from number of data points
    let score = Math.min(prices.length * 2, 40)

    // Add score for source diversity
    const sourceCount = new Set(prices.map(p => p.source)).size
    score += Math.min(sourceCount * 10, 30)

    // Add score for data freshness
    const avgAge = prices.reduce((sum, p) => {
      return sum + (Date.now() - p.last_scraped.getTime()) / (1000 * 60 * 60)
    }, 0) / prices.length
    score += Math.max(0, 20 - avgAge) // Up to 20 points for fresh data

    // Add score for historical data availability
    score += Math.min(history.length, 10)

    return Math.min(100, score)
  }

  private async getHotCards(gameFilter?: string, limit: number = 20): Promise<any[]> {
    // TODO: Implement hot cards detection based on volume and price movement
    return []
  }

  private async getTrendingUpCards(gameFilter?: string, limit: number = 20): Promise<any[]> {
    // TODO: Implement trending up detection
    return []
  }

  private async getTrendingDownCards(gameFilter?: string, limit: number = 20): Promise<any[]> {
    // TODO: Implement trending down detection
    return []
  }

  private async getInvestmentOpportunities(gameFilter?: string, limit: number = 20): Promise<any[]> {
    // TODO: Implement investment opportunity detection
    return []
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
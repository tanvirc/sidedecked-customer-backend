import { Repository } from 'typeorm'
import { AppDataSource } from '../config/database'
import { PriceHistory, PriceSnapshot } from '../entities/PriceHistory'
import { MarketPrice } from '../entities/MarketPrice'
import { logger } from '../config/logger'

export interface PriceHistoryQuery {
  catalog_sku: string
  condition?: string
  language?: string
  days?: number
  aggregation?: 'daily' | 'weekly' | 'monthly'
}

export interface PriceTrendData {
  date: string
  lowest_price: number
  average_price: number
  highest_price: number
  market_price: number
  listings_count: number
  in_stock_count: number
  price_volatility: number
  market_confidence: number
}

export interface MarketAnalysis {
  catalog_sku: string
  condition: string
  language: string
  current_market_price: number
  price_trend: 'up' | 'down' | 'stable'
  trend_percentage: number
  weekly_change: number
  monthly_change: number
  volatility: number
  confidence_score: number
  recommendation: 'buy' | 'hold' | 'sell' | 'watch'
  analysis_date: Date
}

export class PriceHistoryService {
  private priceHistoryRepo: Repository<PriceHistory>
  private marketPriceRepo: Repository<MarketPrice>

  constructor() {
    this.priceHistoryRepo = AppDataSource.getRepository(PriceHistory)
    this.marketPriceRepo = AppDataSource.getRepository(MarketPrice)
  }

  /**
   * Get price history for a catalog SKU
   */
  async getPriceHistory(query: PriceHistoryQuery): Promise<PriceTrendData[]> {
    const {
      catalog_sku,
      condition = 'NM',
      language = 'EN',
      days = 30,
      aggregation = 'daily'
    } = query

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const history = await this.priceHistoryRepo.find({
      where: {
        catalog_sku,
        condition,
        language,
        aggregation_period: aggregation
      },
      order: { recorded_at: 'ASC' }
    })

    return history
      .filter(record => record.recorded_at >= startDate)
      .map(record => ({
        date: record.recorded_at.toISOString().split('T')[0],
        lowest_price: Number(record.lowest_price),
        average_price: Number(record.average_price),
        highest_price: Number(record.highest_price),
        market_price: Number(record.market_price),
        listings_count: record.listings_count,
        in_stock_count: record.in_stock_count,
        price_volatility: record.price_volatility,
        market_confidence: record.market_confidence
      }))
  }

  /**
   * Get current market analysis for a catalog SKU
   */
  async getMarketAnalysis(
    catalog_sku: string,
    condition: string = 'NM',
    language: string = 'EN'
  ): Promise<MarketAnalysis | null> {
    try {
      // Get current market prices
      const currentPrices = await this.marketPriceRepo.find({
        where: { 
          catalog_sku, 
          condition, 
          language,
          is_available: true 
        },
        order: { price: 'ASC' }
      })

      if (currentPrices.length === 0) {
        return null
      }

      // Get recent price history for trend analysis
      const recentHistory = await this.priceHistoryRepo.find({
        where: { catalog_sku, condition, language },
        order: { recorded_at: 'DESC' },
        take: 30 // Last 30 days
      })

      // Calculate current market price (weighted average of top sources)
      const current_market_price = this.calculateMarketPrice(currentPrices)

      // Calculate trends
      const trends = this.calculatePriceTrends(recentHistory)

      // Calculate recommendation
      const recommendation = this.calculateRecommendation(
        current_market_price,
        trends,
        currentPrices
      )

      return {
        catalog_sku,
        condition,
        language,
        current_market_price,
        price_trend: trends.trend,
        trend_percentage: trends.trend_percentage,
        weekly_change: trends.weekly_change,
        monthly_change: trends.monthly_change,
        volatility: trends.volatility,
        confidence_score: trends.confidence_score,
        recommendation,
        analysis_date: new Date()
      }
    } catch (error) {
      logger.error('Error generating market analysis', { catalog_sku, condition, language, error })
      throw error
    }
  }

  /**
   * Aggregate current market prices into historical record
   */
  async aggregateMarketPrices(
    catalog_sku: string,
    condition: string,
    language: string,
    aggregation_period: 'daily' | 'weekly' | 'monthly' = 'daily'
  ): Promise<PriceHistory> {
    try {
      // Get all current market prices for this SKU/condition/language
      const marketPrices = await this.marketPriceRepo.find({
        where: { 
          catalog_sku, 
          condition, 
          language,
          is_available: true 
        }
      })

      if (marketPrices.length === 0) {
        throw new Error(`No market prices found for ${catalog_sku} ${condition} ${language}`)
      }

      // Calculate aggregated statistics
      const prices = marketPrices.map(p => p.price_per_unit)
      const sortedPrices = prices.sort((a, b) => a - b)

      const lowest_price = sortedPrices[0]
      const highest_price = sortedPrices[sortedPrices.length - 1]
      const average_price = prices.reduce((sum, p) => sum + p, 0) / prices.length
      const market_price = this.calculateMarketPrice(marketPrices)

      // Count listings and in-stock items
      const listings_count = marketPrices.length
      const in_stock_count = marketPrices.filter(p => 
        p.stock_quantity && p.stock_quantity > 0
      ).length

      // Create price snapshots
      const price_sources: PriceSnapshot[] = marketPrices.map(price => ({
        source: price.source,
        price: price.price,
        url: price.listing_url,
        seller: price.seller_name,
        condition: price.condition,
        language: price.language,
        currency: price.currency,
        shipping: price.shipping_cost,
        stock_quantity: price.stock_quantity,
        last_seen: price.last_scraped
      }))

      // Get or create price history record for today
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      let priceHistory = await this.priceHistoryRepo.findOne({
        where: {
          catalog_sku,
          condition,
          language,
          aggregation_period,
          recorded_at: today
        }
      })

      if (priceHistory) {
        // Update existing record
        priceHistory.lowest_price = lowest_price
        priceHistory.average_price = average_price
        priceHistory.highest_price = highest_price
        priceHistory.market_price = market_price
        priceHistory.listings_count = listings_count
        priceHistory.in_stock_count = in_stock_count
        priceHistory.price_sources = price_sources
      } else {
        // Create new record
        priceHistory = this.priceHistoryRepo.create({
          catalog_sku,
          condition,
          language,
          lowest_price,
          average_price,
          highest_price,
          market_price,
          listings_count,
          in_stock_count,
          price_sources,
          aggregation_period,
          recorded_at: today
        })
      }

      return await this.priceHistoryRepo.save(priceHistory)
    } catch (error) {
      logger.error('Error aggregating market prices', { 
        catalog_sku, 
        condition, 
        language, 
        aggregation_period, 
        error 
      })
      throw error
    }
  }

  /**
   * Calculate weighted market price from multiple sources
   */
  private calculateMarketPrice(marketPrices: MarketPrice[]): number {
    if (marketPrices.length === 0) return 0

    // Weight sources by trustworthiness and recency
    let totalWeight = 0
    let weightedSum = 0

    for (const price of marketPrices) {
      let weight = 1

      // Trust weight
      switch (price.seller_trustworthiness) {
        case 'high': weight *= 1.5; break
        case 'medium': weight *= 1.2; break
        case 'low': weight *= 0.8; break
        case 'unknown': weight *= 0.9; break
      }

      // Recency weight (more recent = higher weight)
      const hoursSinceScrape = (Date.now() - price.last_scraped.getTime()) / (1000 * 60 * 60)
      weight *= Math.max(0.1, 1 - (hoursSinceScrape / 24)) // Decays over 24 hours

      // Stock availability weight
      if (price.stock_quantity && price.stock_quantity > 0) {
        weight *= 1.2
      }

      weightedSum += price.price_per_unit * weight
      totalWeight += weight
    }

    return totalWeight > 0 ? weightedSum / totalWeight : marketPrices[0].price_per_unit
  }

  /**
   * Calculate price trends from historical data
   */
  private calculatePriceTrends(history: PriceHistory[]) {
    if (history.length < 2) {
      return {
        trend: 'stable' as const,
        trend_percentage: 0,
        weekly_change: 0,
        monthly_change: 0,
        volatility: 0,
        confidence_score: 0
      }
    }

    const latest = history[0]
    const weekAgo = history.find(h => {
      const daysDiff = (latest.recorded_at.getTime() - h.recorded_at.getTime()) / (1000 * 60 * 60 * 24)
      return daysDiff >= 7
    })
    const monthAgo = history.find(h => {
      const daysDiff = (latest.recorded_at.getTime() - h.recorded_at.getTime()) / (1000 * 60 * 60 * 24)
      return daysDiff >= 30
    })

    // Calculate changes
    const weekly_change = weekAgo 
      ? ((latest.market_price - weekAgo.market_price) / weekAgo.market_price) * 100 
      : 0
    const monthly_change = monthAgo 
      ? ((latest.market_price - monthAgo.market_price) / monthAgo.market_price) * 100 
      : 0

    // Determine trend
    let trend: 'up' | 'down' | 'stable' = 'stable'
    const trend_percentage = weekly_change

    if (Math.abs(weekly_change) > 5) { // 5% threshold
      trend = weekly_change > 0 ? 'up' : 'down'
    }

    // Calculate volatility (average of individual volatilities)
    const volatility = history.reduce((sum, h) => sum + h.price_volatility, 0) / history.length

    // Calculate confidence (average of individual confidences)
    const confidence_score = history.reduce((sum, h) => sum + h.market_confidence, 0) / history.length

    return {
      trend,
      trend_percentage,
      weekly_change,
      monthly_change,
      volatility,
      confidence_score
    }
  }

  /**
   * Calculate buy/sell recommendation
   */
  private calculateRecommendation(
    current_price: number,
    trends: any,
    marketPrices: MarketPrice[]
  ): 'buy' | 'hold' | 'sell' | 'watch' {
    // Simple recommendation logic - can be enhanced
    if (trends.confidence_score < 30) return 'watch'
    
    if (trends.weekly_change < -10 && trends.volatility < 20) return 'buy'
    if (trends.weekly_change > 15 && trends.volatility > 30) return 'sell'
    
    return 'hold'
  }

  /**
   * Get popular cards by price movement
   */
  async getTrendingCards(
    timeframe: 'daily' | 'weekly' | 'monthly' = 'weekly',
    limit: number = 20
  ): Promise<any[]> {
    // This would query the most volatile or trending cards
    // For now, return placeholder
    return []
  }

  /**
   * Clean up old price history records
   */
  async cleanupOldRecords(daysToKeep: number = 365): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

    const result = await this.priceHistoryRepo
      .createQueryBuilder()
      .delete()
      .where('recorded_at < :cutoffDate', { cutoffDate })
      .execute()

    return result.affected || 0
  }
}
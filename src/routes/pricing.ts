import { Router } from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { PriceHistoryService } from '../services/PriceHistoryService'
import { logger } from '../config/logger'

const router = Router()
const priceHistoryService = new PriceHistoryService()

/**
 * GET /api/pricing/history/:catalog_sku
 * Get price history for a catalog SKU
 */
router.get('/history/:catalog_sku', 
  param('catalog_sku').isString().isLength({ min: 1, max: 100 }),
  query('condition').optional().isIn(['NM', 'LP', 'MP', 'HP', 'DMG']),
  query('language').optional().isLength({ min: 2, max: 10 }),
  query('days').optional().isInt({ min: 1, max: 365 }),
  query('aggregation').optional().isIn(['daily', 'weekly', 'monthly']),
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        })
      }

      const { catalog_sku } = req.params as any as { catalog_sku: string }
      const {
        condition = 'NM',
        language = 'EN',
        days = 30,
        aggregation = 'daily'
      } = req.query as { condition?: string, language?: string, days?: string, aggregation?: string }

      const priceHistory = await priceHistoryService.getPriceHistory({
        catalog_sku,
        condition: condition as string,
        language: language as string,
        days: parseInt(days as string),
        aggregation: aggregation as 'daily' | 'weekly' | 'monthly'
      })

      res.json({
        success: true,
        data: {
          catalog_sku,
          condition,
          language,
          aggregation,
          history: priceHistory
        }
      })

    } catch (error) {
      logger.error('Error getting price history', { catalog_sku: (req.params as { catalog_sku: string }).catalog_sku, error })
      res.status(500).json({
        success: false,
        message: 'Failed to get price history',
        error: (error as Error).message
      })
    }
  }
)

/**
 * GET /api/pricing/analysis/:catalog_sku
 * Get current market analysis for a catalog SKU
 */
router.get('/analysis/:catalog_sku',
  param('catalog_sku').isString().isLength({ min: 1, max: 100 }),
  query('condition').optional().isIn(['NM', 'LP', 'MP', 'HP', 'DMG']),
  query('language').optional().isLength({ min: 2, max: 10 }),
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        })
      }

      const { catalog_sku } = req.params as any
      const {
        condition = 'NM',
        language = 'EN'
      } = req.query as any

      const marketAnalysis = await priceHistoryService.getMarketAnalysis(
        catalog_sku,
        condition as string,
        language as string
      )

      if (!marketAnalysis) {
        return res.status(404).json({
          success: false,
          message: 'No market data available for this card'
        })
      }

      res.json({
        success: true,
        data: marketAnalysis
      })

    } catch (error) {
      logger.error('Error getting market analysis', { catalog_sku: (req.params as any).catalog_sku, error })
      res.status(500).json({
        success: false,
        message: 'Failed to get market analysis',
        error: (error as Error).message
      })
    }
  }
)

/**
 * GET /api/pricing/trending
 * Get trending cards by price movement
 */
router.get('/trending',
  query('timeframe').optional().isIn(['daily', 'weekly', 'monthly']),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        })
      }

      const {
        timeframe = 'weekly',
        limit = 20
      } = req.query as any

      const trendingCards = await priceHistoryService.getTrendingCards(
        timeframe as 'daily' | 'weekly' | 'monthly',
        parseInt(limit as string)
      )

      res.json({
        success: true,
        data: {
          timeframe,
          limit,
          trending_cards: trendingCards
        }
      })

    } catch (error) {
      logger.error('Error getting trending cards', { timeframe: (req.query as any).timeframe, error })
      res.status(500).json({
        success: false,
        message: 'Failed to get trending cards',
        error: (error as Error).message
      })
    }
  }
)

/**
 * POST /api/pricing/aggregate/:catalog_sku
 * Manually trigger price aggregation for a specific SKU
 * (Admin/internal use)
 */
router.post('/aggregate/:catalog_sku',
  param('catalog_sku').isString().isLength({ min: 1, max: 100 }),
  body('condition').isIn(['NM', 'LP', 'MP', 'HP', 'DMG']),
  body('language').isLength({ min: 2, max: 10 }),
  body('aggregation_period').optional().isIn(['daily', 'weekly', 'monthly']),
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        })
      }

      const { catalog_sku } = req.params as any
      const {
        condition,
        language,
        aggregation_period = 'daily'
      } = req.body

      const priceHistory = await priceHistoryService.aggregateMarketPrices(
        catalog_sku,
        condition,
        language,
        aggregation_period
      )

      res.json({
        success: true,
        message: 'Price aggregation completed',
        data: {
          catalog_sku,
          condition,
          language,
          aggregation_period,
          price_history: {
            id: priceHistory.id,
            lowest_price: priceHistory.lowest_price,
            average_price: priceHistory.average_price,
            highest_price: priceHistory.highest_price,
            market_price: priceHistory.market_price,
            listings_count: priceHistory.listings_count,
            in_stock_count: priceHistory.in_stock_count,
            recorded_at: priceHistory.recorded_at
          }
        }
      })

    } catch (error) {
      logger.error('Error aggregating market prices', { 
        catalog_sku: (req.params as any).catalog_sku, 
        condition: req.body.condition,
        error 
      })
      res.status(500).json({
        success: false,
        message: 'Failed to aggregate market prices',
        error: (error as Error).message
      })
    }
  }
)

/**
 * GET /api/pricing/compare/:catalog_sku
 * Compare prices across different sources for a catalog SKU
 */
router.get('/compare/:catalog_sku',
  param('catalog_sku').isString().isLength({ min: 1, max: 100 }),
  query('condition').optional().isIn(['NM', 'LP', 'MP', 'HP', 'DMG']),
  query('language').optional().isLength({ min: 2, max: 10 }),
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        })
      }

      const { catalog_sku } = req.params as any
      const {
        condition = 'NM',
        language = 'EN'
      } = req.query as any

      // Get current market prices from MarketPrice entity
      const { AppDataSource } = await import('../config/database')
      const marketPriceRepo = AppDataSource.getRepository(await import('../entities/MarketPrice').then(m => m.MarketPrice))
      
      const marketPrices = await marketPriceRepo.find({
        where: {
          catalog_sku,
          condition: condition as string,
          language: language as string,
          is_available: true
        },
        order: { price: 'ASC' },
        take: 50 // Limit results
      })

      // Group by source
      const priceComparison = marketPrices.reduce((acc, price) => {
        if (!acc[price.source]) {
          acc[price.source] = {
            source: price.source,
            lowest_price: price.price_per_unit,
            highest_price: price.price_per_unit,
            average_price: 0,
            listings: [],
            total_listings: 0,
            in_stock_listings: 0
          }
        }

        const sourceData = acc[price.source]
        sourceData.lowest_price = Math.min(sourceData.lowest_price, price.price_per_unit)
        sourceData.highest_price = Math.max(sourceData.highest_price, price.price_per_unit)
        sourceData.listings.push({
          price: price.price_per_unit,
          seller: price.seller_name,
          seller_rating: price.seller_rating,
          stock_quantity: price.stock_quantity,
          listing_url: price.listing_url,
          last_scraped: price.last_scraped,
          trustworthiness: price.seller_trustworthiness
        })
        sourceData.total_listings++
        if (price.stock_quantity && price.stock_quantity > 0) {
          sourceData.in_stock_listings++
        }

        return acc
      }, {} as Record<string, any>)

      // Calculate averages
      Object.values(priceComparison).forEach((source: any) => {
        source.average_price = source.listings.reduce((sum: number, listing: any) => sum + listing.price, 0) / source.listings.length
        // Sort listings by price
        source.listings.sort((a: any, b: any) => a.price - b.price)
        // Keep only top 10 listings per source
        source.listings = source.listings.slice(0, 10)
      })

      res.json({
        success: true,
        data: {
          catalog_sku,
          condition,
          language,
          sources: Object.values(priceComparison),
          summary: {
            total_sources: Object.keys(priceComparison).length,
            total_listings: marketPrices.length,
            lowest_overall: Math.min(...marketPrices.map(p => p.price_per_unit)),
            highest_overall: Math.max(...marketPrices.map(p => p.price_per_unit)),
            average_overall: marketPrices.reduce((sum, p) => sum + p.price_per_unit, 0) / marketPrices.length
          }
        }
      })

    } catch (error) {
      logger.error('Error comparing prices', { catalog_sku: (req.params as any).catalog_sku, error })
      res.status(500).json({
        success: false,
        message: 'Failed to compare prices',
        error: (error as Error).message
      })
    }
  }
)

/**
 * GET /api/pricing/alerts/:user_id
 * Get price alerts for a user (this could be moved to a dedicated alerts route)
 */
router.get('/alerts/:user_id',
  param('user_id').isUUID(),
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        })
      }

      const { user_id } = req.params as any
      
      const { PriceAlertService } = await import('../services/PriceAlertService')
      const priceAlertService = new PriceAlertService()
      
      const alerts = await priceAlertService.getUserPriceAlerts(user_id)

      res.json({
        success: true,
        data: {
          user_id,
          alerts
        }
      })

    } catch (error) {
      logger.error('Error getting user price alerts', { user_id: (req.params as any).user_id, error })
      res.status(500).json({
        success: false,
        message: 'Failed to get price alerts',
        error: (error as Error).message
      })
    }
  }
)

export default router
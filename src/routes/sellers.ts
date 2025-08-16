import { Router } from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { SellerReviewService } from '../services/SellerReviewService'
import { TrustScoreService } from '../services/TrustScoreService'
import { AppDataSource } from '../config/database'
import { SellerRating } from '../entities/SellerRating'
import { logger } from '../config/logger'

const router = Router()
const sellerReviewService = new SellerReviewService()
const trustScoreService = new TrustScoreService()

/**
 * GET /api/sellers/:seller_id/reviews
 * Get reviews for a specific seller
 */
router.get('/:seller_id/reviews',
  param('seller_id').isString().isLength({ min: 1, max: 100 }),
  query('rating').optional().isInt({ min: 1, max: 5 }),
  query('review_type').optional().isIn(['purchase', 'communication', 'shipping', 'overall']),
  query('verified_only').optional().isBoolean(),
  query('days_back').optional().isInt({ min: 1, max: 365 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
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

      const { seller_id } = req.params as any
      const {
        rating,
        review_type,
        verified_only,
        days_back,
        limit = 20,
        offset = 0
      } = req.query as any

      const filters = {
        rating: rating ? parseInt(rating as string) : undefined,
        review_type: review_type as any,
        is_verified_purchase: verified_only === 'true' ? true : undefined,
        days_back: days_back ? parseInt(days_back as string) : undefined,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      }

      const result = await sellerReviewService.getSellerReviews(seller_id, filters)

      res.json({
        success: true,
        data: {
          seller_id,
          reviews: result.reviews,
          total: result.total,
          filters: {
            ...filters,
            applied: Object.keys(filters).filter(key => 
              filters[key as keyof typeof filters] !== undefined
            )
          }
        }
      })

    } catch (error) {
      logger.error('Error getting seller reviews', { seller_id: (req.params as any).seller_id, error })
      res.status(500).json({
        success: false,
        message: 'Failed to get seller reviews',
        error: (error as Error).message
      })
    }
  }
)

/**
 * GET /api/sellers/:seller_id/reviews/summary
 * Get review summary for a specific seller
 */
router.get('/:seller_id/reviews/summary',
  param('seller_id').isString().isLength({ min: 1, max: 100 }),
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

      const { seller_id } = req.params as any
      const summary = await sellerReviewService.getSellerReviewSummary(seller_id)

      res.json({
        success: true,
        data: summary
      })

    } catch (error) {
      logger.error('Error getting seller review summary', { seller_id: (req.params as any).seller_id, error })
      res.status(500).json({
        success: false,
        message: 'Failed to get seller review summary',
        error: (error as Error).message
      })
    }
  }
)

/**
 * POST /api/sellers/:seller_id/reviews
 * Create a new review for a seller
 */
router.post('/:seller_id/reviews',
  param('seller_id').isString().isLength({ min: 1, max: 100 }),
  body('customer_id').isString().isLength({ min: 1, max: 100 }),
  body('rating').isInt({ min: 1, max: 5 }),
  body('order_id').optional().isString(),
  body('product_id').optional().isString(),
  body('title').optional().isString().isLength({ max: 200 }),
  body('comment').optional().isString().isLength({ max: 2000 }),
  body('review_type').optional().isIn(['purchase', 'communication', 'shipping', 'overall']),
  body('item_as_described_rating').optional().isInt({ min: 1, max: 5 }),
  body('shipping_speed_rating').optional().isInt({ min: 1, max: 5 }),
  body('communication_rating').optional().isInt({ min: 1, max: 5 }),
  body('packaging_rating').optional().isInt({ min: 1, max: 5 }),
  body('images').optional().isArray(),
  body('is_verified_purchase').optional().isBoolean(),
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

      const { seller_id } = req.params as any
      const reviewData = {
        seller_id,
        ...req.body
      }

      const review = await sellerReviewService.createReview(reviewData)

      res.status(201).json({
        success: true,
        message: 'Review created successfully',
        data: review
      })

    } catch (error) {
      logger.error('Error creating seller review', { seller_id: (req.params as any).seller_id, error })
      res.status(500).json({
        success: false,
        message: 'Failed to create review',
        error: (error as Error).message
      })
    }
  }
)

/**
 * POST /api/sellers/:seller_id/reviews/:review_id/response
 * Add seller response to a review
 */
router.post('/:seller_id/reviews/:review_id/response',
  param('seller_id').isString().isLength({ min: 1, max: 100 }),
  param('review_id').isUUID(),
  body('response').isString().isLength({ min: 1, max: 1000 }),
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

      const { seller_id, review_id } = req.params as any
      const { response } = req.body

      const review = await sellerReviewService.addSellerResponse(review_id, seller_id, response)

      res.json({
        success: true,
        message: 'Seller response added successfully',
        data: review
      })

    } catch (error) {
      logger.error('Error adding seller response', { 
        seller_id: (req.params as any).seller_id, 
        review_id: (req.params as any).review_id, 
        error 
      })
      res.status(500).json({
        success: false,
        message: 'Failed to add seller response',
        error: (error as Error).message
      })
    }
  }
)

/**
 * POST /api/sellers/reviews/:review_id/vote
 * Vote on review helpfulness
 */
router.post('/reviews/:review_id/vote',
  param('review_id').isUUID(),
  body('customer_id').isString().isLength({ min: 1, max: 100 }),
  body('is_helpful').isBoolean(),
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

      const { review_id } = req.params as any
      const { customer_id, is_helpful } = req.body

      const review = await sellerReviewService.voteOnReview(review_id, customer_id, is_helpful)

      res.json({
        success: true,
        message: 'Vote recorded successfully',
        data: {
          review_id,
          helpful_votes: review.helpful_votes,
          total_votes: review.total_votes,
          helpful_percentage: review.helpful_percentage
        }
      })

    } catch (error) {
      logger.error('Error voting on review', { review_id: (req.params as any).review_id, error })
      res.status(500).json({
        success: false,
        message: 'Failed to record vote',
        error: (error as Error).message
      })
    }
  }
)

/**
 * GET /api/sellers/:seller_id/rating
 * Get seller rating and trust information
 */
router.get('/:seller_id/rating',
  param('seller_id').isString().isLength({ min: 1, max: 100 }),
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

      const { seller_id } = req.params as any
      
      const sellerRatingRepo = AppDataSource.getRepository(SellerRating)
      const sellerRating = await sellerRatingRepo.findOne({ where: { seller_id } })

      if (!sellerRating) {
        return res.status(404).json({
          success: false,
          message: 'Seller rating not found'
        })
      }

      res.json({
        success: true,
        data: {
          seller_id,
          overall_rating: sellerRating.overall_rating,
          total_reviews: sellerRating.total_reviews,
          total_orders: sellerRating.total_orders,
          breakdown_ratings: {
            item_as_described: sellerRating.item_as_described_rating,
            shipping_speed: sellerRating.shipping_speed_rating,
            communication: sellerRating.communication_rating,
            packaging: sellerRating.packaging_rating
          },
          performance_metrics: {
            response_rate: sellerRating.response_rate_percentage,
            on_time_shipping: sellerRating.on_time_shipping_percentage,
            dispute_rate: sellerRating.dispute_rate_percentage,
            cancellation_rate: sellerRating.cancellation_rate_percentage
          },
          trust_data: {
            trust_score: sellerRating.trust_score,
            seller_tier: sellerRating.seller_tier,
            verification_status: sellerRating.verification_status,
            trustworthiness_level: sellerRating.trustworthiness_level,
            is_reliable: sellerRating.is_reliable,
            seller_level: sellerRating.seller_level
          },
          verification_badges: sellerRating.verification_badges,
          special_status: {
            is_power_seller: sellerRating.is_power_seller,
            is_featured_seller: sellerRating.is_featured_seller,
            is_preferred_seller: sellerRating.is_preferred_seller,
            is_top_rated: sellerRating.is_top_rated
          },
          risk_assessment: {
            risk_level: sellerRating.risk_level,
            risk_notes: sellerRating.risk_notes
          },
          activity_data: {
            months_active: sellerRating.months_active,
            first_sale_at: sellerRating.first_sale_at,
            last_review_at: sellerRating.last_review_at,
            last_order_at: sellerRating.last_order_at
          }
        }
      })

    } catch (error) {
      logger.error('Error getting seller rating', { seller_id: (req.params as any).seller_id, error })
      res.status(500).json({
        success: false,
        message: 'Failed to get seller rating',
        error: (error as Error).message
      })
    }
  }
)

/**
 * GET /api/sellers/:seller_id/trust-analysis
 * Get detailed trust score analysis for a seller
 */
router.get('/:seller_id/trust-analysis',
  param('seller_id').isString().isLength({ min: 1, max: 100 }),
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

      const { seller_id } = req.params as any
      const analysis = await trustScoreService.calculateTrustScore(seller_id)

      res.json({
        success: true,
        data: analysis
      })

    } catch (error) {
      logger.error('Error getting trust analysis', { seller_id: (req.params as any).seller_id, error })
      res.status(500).json({
        success: false,
        message: 'Failed to get trust analysis',
        error: (error as Error).message
      })
    }
  }
)

/**
 * GET /api/sellers/top-rated
 * Get list of top-rated sellers
 */
router.get('/top-rated',
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('tier').optional().isIn(['bronze', 'silver', 'gold', 'platinum', 'diamond']),
  query('game').optional().isString(),
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
        limit = 20,
        tier,
        game
      } = req.query as any

      const sellerRatingRepo = AppDataSource.getRepository(SellerRating)
      
      let queryBuilder = sellerRatingRepo.createQueryBuilder('seller_rating')
        .where('seller_rating.total_reviews >= :minReviews', { minReviews: 5 })
        .andWhere('seller_rating.overall_rating >= :minRating', { minRating: 4.0 })

      if (tier) {
        queryBuilder = queryBuilder.andWhere('seller_rating.seller_tier = :tier', { tier })
      }

      // TODO: Add game filtering when seller-game association is available
      if (game) {
        // This would require joining with seller product data
        logger.info(`Game filter requested but not yet implemented: ${game}`)
      }

      const topSellers = await queryBuilder
        .orderBy('seller_rating.trust_score', 'DESC')
        .addOrderBy('seller_rating.overall_rating', 'DESC')
        .addOrderBy('seller_rating.total_reviews', 'DESC')
        .limit(parseInt(limit as string))
        .getMany()

      res.json({
        success: true,
        data: {
          sellers: topSellers.map(seller => ({
            seller_id: seller.seller_id,
            overall_rating: seller.overall_rating,
            total_reviews: seller.total_reviews,
            trust_score: seller.trust_score,
            seller_tier: seller.seller_tier,
            seller_level: seller.seller_level,
            verification_badges: seller.verification_badges,
            months_active: seller.months_active,
            is_top_rated: seller.is_top_rated,
            is_power_seller: seller.is_power_seller
          })),
          total: topSellers.length,
          filters: { tier, game, limit }
        }
      })

    } catch (error) {
      logger.error('Error getting top-rated sellers', error)
      res.status(500).json({
        success: false,
        message: 'Failed to get top-rated sellers',
        error: (error as Error).message
      })
    }
  }
)

/**
 * POST /api/sellers/batch/trust-scores
 * Calculate trust scores for multiple sellers (admin/internal use)
 */
router.post('/batch/trust-scores',
  body('seller_ids').isArray().custom((value) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
      throw new Error('seller_ids must be an array with 1-100 items')
    }
    return true
  }),
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

      const { seller_ids } = req.body
      const analyses = await trustScoreService.batchCalculateTrustScores(seller_ids)

      res.json({
        success: true,
        data: {
          total_processed: analyses.length,
          analyses
        }
      })

    } catch (error) {
      logger.error('Error batch calculating trust scores', error)
      res.status(500).json({
        success: false,
        message: 'Failed to calculate trust scores',
        error: (error as Error).message
      })
    }
  }
)

export default router
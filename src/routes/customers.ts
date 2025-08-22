import { Router } from 'express'
import { body, param, validationResult } from 'express-validator'
import { AppDataSource } from '../config/database'
import { SellerRating, SellerTier, VerificationStatus } from '../entities/SellerRating'
import { logger } from '../config/logger'

const router = Router()

/**
 * GET /api/customers/:customer_id/seller-status
 * Check if a customer has seller privileges
 */
router.get('/:customer_id/seller-status',
  param('customer_id').isString().isLength({ min: 1, max: 100 }),
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

      const { customer_id } = req.params as any

      // For now, we'll store seller status in a simple way
      // In the future, this could be more sophisticated with a dedicated Customer entity
      // For MVP, we'll check if the customer exists in our SellerRating table
      const sellerRatingRepo = AppDataSource.getRepository(SellerRating)
      
      try {
        const sellerRecord = await sellerRatingRepo.findOne({ 
          where: { seller_id: customer_id } 
        })

        const isSeller = !!sellerRecord

        res.json({
          success: true,
          data: {
            customer_id,
            is_seller: isSeller,
            seller_since: sellerRecord?.first_sale_at || null,
            seller_tier: sellerRecord?.seller_tier || null,
            verification_status: sellerRecord?.verification_status || 'unverified'
          }
        })

      } catch (dbError) {
        logger.error('Database error checking seller status', { customer_id, error: dbError })
        
        // Fallback: assume not a seller if we can't check
        res.json({
          success: true,
          data: {
            customer_id,
            is_seller: false,
            seller_since: null,
            seller_tier: null,
            verification_status: 'unverified'
          }
        })
      }

    } catch (error) {
      logger.error('Error checking seller status', { customer_id: (req.params as any).customer_id, error })
      res.status(500).json({
        success: false,
        message: 'Failed to check seller status',
        error: (error as Error).message
      })
    }
  }
)

/**
 * POST /api/customers/:customer_id/upgrade-to-seller
 * Upgrade a customer to seller status
 */
router.post('/:customer_id/upgrade-to-seller',
  param('customer_id').isString().isLength({ min: 1, max: 100 }),
  body('seller_type').isIn(['consumer', 'business']),
  body('agreed_to_terms').isBoolean(),
  body('timestamp').isISO8601(),
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

      const { customer_id } = req.params as any
      const { seller_type, agreed_to_terms, timestamp } = req.body

      if (!agreed_to_terms) {
        return res.status(400).json({
          success: false,
          message: 'Must agree to seller terms to upgrade account'
        })
      }

      // Check if customer is already a seller
      const sellerRatingRepo = AppDataSource.getRepository(SellerRating)
      const existingSeller = await sellerRatingRepo.findOne({ 
        where: { seller_id: customer_id } 
      })

      if (existingSeller) {
        return res.status(409).json({
          success: false,
          message: 'Customer is already a seller',
          data: {
            customer_id,
            is_seller: true,
            seller_tier: existingSeller.seller_tier
          }
        })
      }

      // Create initial seller rating record
      const initialSellerData = {
        seller_id: customer_id,
        overall_rating: 0.0,
        total_reviews: 0,
        total_orders: 0,
        total_sales_volume: 0,
        item_as_described_rating: 0.0,
        shipping_speed_rating: 0.0,
        communication_rating: 0.0,
        packaging_rating: 0.0,
        response_rate_percentage: 0.0,
        on_time_shipping_percentage: 0.0,
        dispute_rate_percentage: 0.0,
        cancellation_rate_percentage: 0.0,
        recent_orders_count: 0,
        recent_average_rating: 0.0,
        recent_disputes: 0,
        trust_score: 60, // Starting score for new sellers
        seller_tier: SellerTier.BRONZE,
        verification_status: VerificationStatus.UNVERIFIED,
        is_business_verified: seller_type === 'business',
        is_identity_verified: false,
        is_address_verified: false,
        is_payment_verified: false,
        is_power_seller: false,
        is_featured_seller: false,
        is_preferred_seller: false,
        is_top_rated: false,
        months_active: 0,
        consecutive_months_active: 0,
        risk_level: 'medium' as const,
        risk_notes: 'New seller - limited history'
      }

      const newSeller = sellerRatingRepo.create(initialSellerData)
      await sellerRatingRepo.save(newSeller)

      logger.info('Customer upgraded to seller', { 
        customer_id, 
        seller_type, 
        timestamp 
      })

      res.status(201).json({
        success: true,
        message: 'Successfully upgraded to seller account',
        data: {
          customer_id,
          is_seller: true,
          seller_type,
          seller_tier: SellerTier.BRONZE,
          trust_score: 60,
          verification_status: VerificationStatus.UNVERIFIED,
          terms_agreed_at: timestamp,
          next_steps: {
            complete_verification: '/user/settings',
            create_first_listing: '/sell/list-card',
            setup_payments: '/user/settings'
          }
        }
      })

    } catch (error) {
      logger.error('Error upgrading customer to seller', { 
        customer_id: (req.params as any).customer_id, 
        error 
      })
      res.status(500).json({
        success: false,
        message: 'Failed to upgrade to seller account',
        error: (error as Error).message
      })
    }
  }
)

/**
 * GET /api/customers/:customer_id/profile
 * Get customer profile information including seller data
 */
router.get('/:customer_id/profile',
  param('customer_id').isString().isLength({ min: 1, max: 100 }),
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

      const { customer_id } = req.params as any

      // Get seller information if available
      const sellerRatingRepo = AppDataSource.getRepository(SellerRating)
      const sellerData = await sellerRatingRepo.findOne({ 
        where: { seller_id: customer_id } 
      })

      const profile = {
        customer_id,
        is_seller: !!sellerData,
        seller_data: sellerData ? {
          seller_tier: sellerData.seller_tier,
          trust_score: sellerData.trust_score,
          overall_rating: sellerData.overall_rating,
          total_reviews: sellerData.total_reviews,
          total_orders: sellerData.total_orders,
          verification_status: sellerData.verification_status,
          verification_badges: sellerData.verification_badges,
          seller_level: sellerData.seller_level,
          months_active: sellerData.months_active,
          is_power_seller: sellerData.is_power_seller,
          is_top_rated: sellerData.is_top_rated,
          performance_metrics: {
            response_rate: sellerData.response_rate_percentage,
            on_time_shipping: sellerData.on_time_shipping_percentage,
            dispute_rate: sellerData.dispute_rate_percentage
          }
        } : null
      }

      res.json({
        success: true,
        data: profile
      })

    } catch (error) {
      logger.error('Error getting customer profile', { customer_id: (req.params as any).customer_id, error })
      res.status(500).json({
        success: false,
        message: 'Failed to get customer profile',
        error: (error as Error).message
      })
    }
  }
)

export default router
import { Router } from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { In } from 'typeorm'
import { AppDataSource } from '../config/database'
import { Wishlist } from '../entities/Wishlist'
import { WishlistItem } from '../entities/WishlistItem'
import { PriceAlertService } from '../services/PriceAlertService'
import { AlertType } from '../entities/PriceAlert'
import { logger } from '../config/logger'
import { v4 as uuidv4 } from 'uuid'

const router = Router()
const priceAlertService = new PriceAlertService()

// Get all wishlists for a user
router.get('/user/:userId',
  param('userId').isUUID().withMessage('User ID must be a valid UUID'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
        timestamp: new Date().toISOString()
      })
    }

    try {
      const { userId } = req.params as any
      
      const wishlistRepository = AppDataSource.getRepository(Wishlist)
      const wishlists = await wishlistRepository.find({
        where: { user_id: userId },
        relations: ['items'],
        order: { created_at: 'DESC' }
      })

      res.json({
        success: true,
        data: { wishlists },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error fetching user wishlists', error as Error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch wishlists',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

// Create a new wishlist
router.post('/',
  body('user_id').isUUID().withMessage('User ID must be a valid UUID'),
  body('name').isString().isLength({ min: 1, max: 255 }).withMessage('Name must be between 1 and 255 characters'),
  body('description').optional().isString().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
  body('is_public').optional().isBoolean().withMessage('is_public must be a boolean'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
        timestamp: new Date().toISOString()
      })
    }

    try {
      const { user_id, name, description, is_public = false } = req.body
      
      const wishlistRepository = AppDataSource.getRepository(Wishlist)
      
      // Generate share token if public
      const share_token = is_public ? uuidv4().replace(/-/g, '').substring(0, 20) : undefined
      
      const wishlist = wishlistRepository.create({
        user_id,
        name,
        description,
        is_public,
        share_token
      })

      const savedWishlist = await wishlistRepository.save(wishlist)
      
      res.status(201).json({
        success: true,
        data: { wishlist: savedWishlist },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error creating wishlist', error as Error)
      
      // Handle unique constraint violation
      if ((error as any).code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Wishlist with this name already exists',
          timestamp: new Date().toISOString()
        })
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to create wishlist',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

// Add item to wishlist
router.post('/:wishlistId/items',
  param('wishlistId').isUUID().withMessage('Wishlist ID must be a valid UUID'),
  body('catalog_sku').isString().isLength({ min: 1, max: 200 }).withMessage('Catalog SKU is required'),
  body('max_price').optional().isFloat({ min: 0 }).withMessage('Max price must be a positive number'),
  body('preferred_condition').optional().isString().isLength({ max: 10 }).withMessage('Preferred condition must be less than 10 characters'),
  body('preferred_language').optional().isString().isLength({ max: 10 }).withMessage('Preferred language must be less than 10 characters'),
  body('notes').optional().isString().isLength({ max: 1000 }).withMessage('Notes must be less than 1000 characters'),
  body('enable_price_alerts').optional().isBoolean().withMessage('enable_price_alerts must be a boolean'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
        timestamp: new Date().toISOString()
      })
    }

    try {
      const { wishlistId } = req.params as any
      const { 
        catalog_sku, 
        max_price, 
        preferred_condition, 
        preferred_language, 
        notes,
        enable_price_alerts = true
      } = req.body
      
      const wishlistRepository = AppDataSource.getRepository(Wishlist)
      const wishlistItemRepository = AppDataSource.getRepository(WishlistItem)
      
      // Check if wishlist exists
      const wishlist = await wishlistRepository.findOne({
        where: { id: wishlistId }
      })
      
      if (!wishlist) {
        return res.status(404).json({
          success: false,
          error: 'Wishlist not found',
          timestamp: new Date().toISOString()
        })
      }
      
      // Get current price for the item
      const currentPrice = await getCurrentPriceForSKU(catalog_sku)
      
      // Create wishlist item
      const itemData = {
        wishlist_id: wishlistId,
        catalog_sku,
        max_price,
        preferred_condition,
        preferred_language,
        notes,
        price_when_added: currentPrice || undefined,
        current_lowest_price: currentPrice || undefined,
        target_price: max_price,
        price_alert_enabled: enable_price_alerts,
        stock_alert_enabled: true
      }
      const wishlistItem = wishlistItemRepository.create(itemData)

      const savedItem = await wishlistItemRepository.save(wishlistItem)
      
      // Update wishlist metadata
      await wishlistRepository.increment({ id: wishlistId }, 'item_count', 1)
      if (currentPrice) {
        await wishlistRepository.increment({ id: wishlistId }, 'total_value', currentPrice)
      }
      
      // Create price alert if requested and max_price is set
      if (enable_price_alerts && max_price) {
        try {
          await priceAlertService.createPriceAlert({
            user_id: wishlist.user_id,
            catalog_sku,
            alert_type: AlertType.PRICE_DROP,
            trigger_price: max_price,
            email_enabled: true,
            sms_enabled: false,
            push_enabled: false
          })
        } catch (alertError) {
          logger.warn('Failed to create price alert for wishlist item', alertError as Error)
          // Don't fail the request if alert creation fails
        }
      }
      
      res.status(201).json({
        success: true,
        data: { item: savedItem },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error adding item to wishlist', error as Error)
      
      // Handle unique constraint violation
      if ((error as any).code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Item already exists in this wishlist',
          timestamp: new Date().toISOString()
        })
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to add item to wishlist',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

// Get wishlist with items and enriched data
router.get('/:wishlistId',
  param('wishlistId').isUUID().withMessage('Wishlist ID must be a valid UUID'),
  query('include_price_history').optional().isBoolean().withMessage('include_price_history must be a boolean'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
        timestamp: new Date().toISOString()
      })
    }

    try {
      const { wishlistId } = req.params as any
      const includePriceHistory = (req.query as any).include_price_history === 'true'
      
      // Get wishlist with items
      const wishlist = await AppDataSource.query(`
        SELECT 
          w.*,
          json_agg(
            json_build_object(
              'id', wi.id,
              'catalog_sku', wi.catalog_sku,
              'max_price', wi.max_price,
              'preferred_condition', wi.preferred_condition,
              'preferred_language', wi.preferred_language,
              'notes', wi.notes,
              'target_price', wi.target_price,
              'price_when_added', wi.price_when_added,
              'current_lowest_price', wi.current_lowest_price,
              'price_alert_enabled', wi.price_alert_enabled,
              'stock_alert_enabled', wi.stock_alert_enabled,
              'is_available', wi.is_available,
              'added_at', wi.added_at,
              'card_name', c.name,
              'set_name', s.name,
              'game_name', g.name,
              'image_normal', p.image_normal,
              'rarity', p.rarity,
              'condition', cs.condition,
              'language', cs.language
            ) ORDER BY wi.added_at DESC
          ) FILTER (WHERE wi.id IS NOT NULL) as items
        FROM wishlists w
        LEFT JOIN wishlist_items wi ON w.id = wi.wishlist_id
        LEFT JOIN catalog_skus cs ON wi.catalog_sku = cs.sku
        LEFT JOIN prints p ON cs.print_id = p.id
        LEFT JOIN cards c ON p.card_id = c.id
        LEFT JOIN card_sets s ON p.set_id = s.id
        LEFT JOIN games g ON c.game_id = g.id
        WHERE w.id = $1
        GROUP BY w.id
      `, [wishlistId])

      if (!wishlist || wishlist.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Wishlist not found',
          timestamp: new Date().toISOString()
        })
      }

      const enrichedWishlist = wishlist[0]
      
      // Calculate summary statistics
      const items = enrichedWishlist.items || []
      const summary = {
        total_items: items.length,
        total_value: items.reduce((sum: number, item: any) => sum + (item.current_lowest_price || 0), 0),
        items_in_stock: items.filter((item: any) => item.is_available).length,
        price_alerts_active: items.filter((item: any) => item.price_alert_enabled).length,
        items_under_target: items.filter((item: any) => 
          item.target_price && item.current_lowest_price && item.current_lowest_price <= item.target_price
        ).length
      }

      res.json({
        success: true,
        data: { 
          wishlist: enrichedWishlist,
          summary 
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error fetching wishlist', error as Error)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch wishlist',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

// Remove item from wishlist
router.delete('/:wishlistId/items/:itemId',
  param('wishlistId').isUUID().withMessage('Wishlist ID must be a valid UUID'),
  param('itemId').isUUID().withMessage('Item ID must be a valid UUID'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
        timestamp: new Date().toISOString()
      })
    }

    try {
      const { wishlistId, itemId } = req.params as any
      
      const wishlistItemRepository = AppDataSource.getRepository(WishlistItem)
      const wishlistRepository = AppDataSource.getRepository(Wishlist)
      
      // Get item to remove
      const item = await wishlistItemRepository.findOne({
        where: { id: itemId, wishlist_id: wishlistId }
      })
      
      if (!item) {
        return res.status(404).json({
          success: false,
          error: 'Wishlist item not found',
          timestamp: new Date().toISOString()
        })
      }
      
      // Remove item
      await wishlistItemRepository.remove(item)
      
      // Update wishlist metadata
      await wishlistRepository.decrement({ id: wishlistId }, 'item_count', 1)
      if (item.current_lowest_price) {
        await wishlistRepository.decrement({ id: wishlistId }, 'total_value', item.current_lowest_price)
      }
      
      res.json({
        success: true,
        message: 'Item removed from wishlist',
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error removing item from wishlist', error as Error)
      res.status(500).json({
        success: false,
        error: 'Failed to remove item from wishlist',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

// Bulk add to cart from wishlist
router.post('/:wishlistId/add-to-cart',
  param('wishlistId').isUUID().withMessage('Wishlist ID must be a valid UUID'),
  body('item_ids').isArray({ min: 1 }).withMessage('item_ids must be a non-empty array'),
  body('item_ids.*').isUUID().withMessage('Each item ID must be a valid UUID'),
  async (req, res) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
        timestamp: new Date().toISOString()
      })
    }

    try {
      const { wishlistId } = req.params as any
      const { item_ids } = req.body
      
      // Get wishlist items
      const wishlistItemRepository = AppDataSource.getRepository(WishlistItem)
      const items = await wishlistItemRepository.find({
        where: { 
          id: In(item_ids),
          wishlist_id: wishlistId
        }
      })
      
      if (items.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No valid wishlist items found',
          timestamp: new Date().toISOString()
        })
      }
      
      // TODO: Integrate with commerce backend to add items to cart
      // This would involve calling the commerce API to find product variants
      // that match the catalog SKUs and adding them to the user's cart
      
      const added_items = items.map(item => ({
        wishlist_item_id: item.id,
        catalog_sku: item.catalog_sku,
        status: 'added' // or 'unavailable' if not found in commerce
      }))
      
      res.json({
        success: true,
        data: {
          added_items,
          total_added: added_items.length,
          total_requested: item_ids.length
        },
        message: 'Items processed for cart addition',
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error adding wishlist items to cart', error as Error)
      res.status(500).json({
        success: false,
        error: 'Failed to add items to cart',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

// Helper function to get current price for a SKU
async function getCurrentPriceForSKU(catalogSku: string): Promise<number | null> {
  try {
    const priceData = await AppDataSource.query(`
      SELECT market_price, avg_price, min_price
      FROM catalog_skus
      WHERE sku = $1
    `, [catalogSku])
    
    if (priceData && priceData.length > 0) {
      const data = priceData[0]
      return data.market_price || data.avg_price || data.min_price
    }
    
    return null
  } catch (error) {
    logger.error(`Error getting price for SKU ${catalogSku}`, error as Error)
    return null
  }
}

export default router
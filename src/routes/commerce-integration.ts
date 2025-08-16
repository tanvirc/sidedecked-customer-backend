import { Router } from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { getInventorySyncService } from '../services/ServiceContainer'
import { logger } from '../config/logger'

const router = Router()

// Commerce integration overview
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SideDecked Commerce Integration API',
    version: '1.0.0',
    endpoints: {
      'GET /inventory/health': 'Check inventory sync service health',
      'GET /inventory/stats': 'Get inventory sync statistics',
      'GET /inventory/:variantId': 'Check inventory for single variant',
      'POST /inventory/check': 'Check inventory for multiple variants',
      'POST /inventory/invalidate': 'Invalidate inventory cache',
      'POST /inventory/prewarm': 'Pre-warm inventory cache',
      'POST /match-product': 'Match vendor product to catalog (TODO)',
      'POST /validate-sku': 'Validate single SKU (TODO)'
    }
  })
})

// Inventory sync endpoints

/**
 * Check inventory sync service health
 */
router.get('/inventory/health', async (req, res) => {
  try {
    const inventoryService = getInventorySyncService()
    const health = await inventoryService.healthCheck()
    
    res.json({
      success: true,
      data: health,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error checking inventory service health', error as Error)
    res.status(503).json({
      success: false,
      error: 'Failed to check inventory service health',
      message: (error as Error).message,
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * Get inventory sync service statistics
 */
router.get('/inventory/stats', async (req, res) => {
  try {
    const inventoryService = getInventorySyncService()
    const stats = await inventoryService.getServiceStats()
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Error getting inventory service stats', error as Error)
    res.status(500).json({
      success: false,
      error: 'Failed to get inventory service statistics',
      message: (error as Error).message,
      timestamp: new Date().toISOString()
    })
  }
})

/**
 * Check inventory for a single variant
 */
router.get('/inventory/:variantId', 
  param('variantId').isString().notEmpty().withMessage('Variant ID is required'),
  query('useCache').optional().isBoolean().withMessage('useCache must be boolean'),
  query('includeLocations').optional().isBoolean().withMessage('includeLocations must be boolean'),
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
      const { variantId } = req.params as { variantId: string }
      const useCache = (req.query?.useCache as string) !== 'false' // Default to true
      const includeLocations = (req.query?.includeLocations as string) === 'true' // Default to false
      
      const inventoryService = getInventorySyncService()
      const result = await inventoryService.checkInventory(
        variantId, 
        useCache, 
        includeLocations
      )
      
      res.json({
        success: true,
        data: {
          variant_id: variantId,
          ...result
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error checking variant inventory', error as Error, { variantId: (req.params as { variantId: string }).variantId })
      res.status(500).json({
        success: false,
        error: 'Failed to check variant inventory',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

/**
 * Check inventory for multiple variants (batch operation)
 */
router.post('/inventory/check',
  body('variantIds').isArray({ min: 1, max: 50 }).withMessage('variantIds must be an array of 1-50 variant IDs'),
  body('variantIds.*').isString().notEmpty().withMessage('Each variant ID must be a non-empty string'),
  body('useCache').optional().isBoolean().withMessage('useCache must be boolean'),
  body('includeLocations').optional().isBoolean().withMessage('includeLocations must be boolean'),
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
      const { variantIds, useCache = true, includeLocations = false } = req.body
      
      const inventoryService = getInventorySyncService()
      const results = await inventoryService.checkMultipleInventory(
        variantIds, 
        useCache, 
        includeLocations
      )
      
      // Convert Map to Object for JSON response
      const data: Record<string, any> = {}
      for (const [variantId, result] of results) {
        data[variantId] = result
      }
      
      res.json({
        success: true,
        data,
        meta: {
          requested_count: variantIds.length,
          retrieved_count: results.size,
          cache_enabled: useCache,
          locations_included: includeLocations
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error checking multiple variant inventories', error as Error)
      res.status(500).json({
        success: false,
        error: 'Failed to check multiple variant inventories',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

/**
 * Invalidate inventory cache for specific variants
 */
router.post('/inventory/invalidate',
  body('variantIds').isArray({ min: 1, max: 100 }).withMessage('variantIds must be an array of 1-100 variant IDs'),
  body('variantIds.*').isString().notEmpty().withMessage('Each variant ID must be a non-empty string'),
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
      const { variantIds } = req.body
      
      const inventoryService = getInventorySyncService()
      await inventoryService.invalidateInventoryCache(variantIds)
      
      res.json({
        success: true,
        message: 'Inventory cache invalidated successfully',
        data: {
          invalidated_count: variantIds.length,
          variant_ids: variantIds
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error invalidating inventory cache', error as Error)
      res.status(500).json({
        success: false,
        error: 'Failed to invalidate inventory cache',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

/**
 * Pre-warm inventory cache for frequently accessed variants
 */
router.post('/inventory/prewarm',
  body('variantIds').isArray({ min: 1, max: 50 }).withMessage('variantIds must be an array of 1-50 variant IDs'),
  body('variantIds.*').isString().notEmpty().withMessage('Each variant ID must be a non-empty string'),
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
      const { variantIds } = req.body
      
      const inventoryService = getInventorySyncService()
      await inventoryService.preWarmCache(variantIds)
      
      res.json({
        success: true,
        message: 'Inventory cache pre-warmed successfully',
        data: {
          prewarmed_count: variantIds.length,
          variant_ids: variantIds
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error pre-warming inventory cache', error as Error)
      res.status(500).json({
        success: false,
        error: 'Failed to pre-warm inventory cache',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

// TODO: Implement remaining commerce integration endpoints as needed
/*
router.post('/match-product', async (req, res) => {
  // Product matching implementation
  res.status(501).json({
    success: false,
    error: 'Not implemented',
    message: 'Product matching will be implemented in Phase 3'
  })
})

router.post('/validate-sku', async (req, res) => {
  // SKU validation implementation  
  res.status(501).json({
    success: false,
    error: 'Not implemented',
    message: 'SKU validation will be implemented in Phase 3'
  })
})
*/

logger.info('Commerce integration routes loaded with inventory sync endpoints')

export default router
import { Router } from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { getInventorySyncService } from '../services/ServiceContainer'
import { AppDataSource } from '../config/database'
import { logger } from '../config/logger'
import { CatalogSKU } from '../entities/CatalogSKU'

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
      'POST /match-product': 'Match vendor product to catalog SKU',
      'POST /validate-sku': 'Validate SKUs and get catalog enrichment data'
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

// Product-to-Catalog SKU Matching Endpoints

/**
 * Match a product variant to catalog SKU for cart enrichment
 */
router.post('/match-product',
  body('productId').isString().notEmpty().withMessage('Product ID is required'),
  body('variantId').isString().notEmpty().withMessage('Variant ID is required'),
  body('sku').optional().isString().withMessage('SKU must be a string'),
  body('productName').optional().isString().withMessage('Product name must be a string'),
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
      const { productId, variantId, sku, productName } = req.body
      
      // Try to find catalog SKU match
      let catalogMatch = null
      
      if (sku) {
        // Direct SKU match using TypeORM with proper relationships
        const catalogSKURepository = AppDataSource.getRepository(CatalogSKU)
        const skuResults = await catalogSKURepository.find({
          where: { sku: sku },
          relations: ['print', 'print.card', 'print.card.game']
        })
        
        catalogMatch = skuResults.map(skuEntity => ({
          ...skuEntity,
          card_name: skuEntity.print?.card?.name,
          game_code: skuEntity.print?.card?.game?.code
        }))
      }
      
      if (!catalogMatch || catalogMatch.length === 0) {
        // Fuzzy match by product name using TypeORM QueryBuilder
        if (productName) {
          const catalogSKURepository = AppDataSource.getRepository(CatalogSKU)
          const skuResults = await catalogSKURepository
            .createQueryBuilder('sku')
            .leftJoinAndSelect('sku.print', 'print')
            .leftJoinAndSelect('print.card', 'card')
            .leftJoinAndSelect('card.game', 'game')
            .where('card.name ILIKE :productName', { productName: `%${productName}%` })
            .limit(5)
            .getMany()
          
          catalogMatch = skuResults.map(skuEntity => ({
            ...skuEntity,
            card_name: skuEntity.print?.card?.name,
            game_code: skuEntity.print?.card?.game?.code
          }))
        }
      }
      
      const result = {
        product_id: productId,
        variant_id: variantId,
        input_sku: sku,
        matches: catalogMatch || [],
        match_method: catalogMatch && catalogMatch.length > 0 ? 
          (sku ? 'exact_sku' : 'fuzzy_name') : 'no_match',
        confidence_score: catalogMatch && catalogMatch.length > 0 ? 
          (sku ? 1.0 : 0.7) : 0.0
      }
      
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error matching product to catalog', error as Error)
      res.status(500).json({
        success: false,
        error: 'Failed to match product to catalog',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

/**
 * Validate catalog SKU and get enrichment data
 */
router.post('/validate-sku',
  body('skus').isArray({ min: 1, max: 20 }).withMessage('skus must be an array of 1-20 SKUs'),
  body('skus.*').isString().notEmpty().withMessage('Each SKU must be a non-empty string'),
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
      const { skus } = req.body
      
      const results: Record<string, any> = {}
      
      for (const sku of skus) {
        try {
          // Use TypeORM with proper entity relationships and correct field mappings
          const catalogSKURepository = AppDataSource.getRepository(CatalogSKU)
          const catalogResults = await catalogSKURepository.find({
            where: { sku: sku },
            relations: ['print', 'print.card', 'print.set', 'print.card.game']
          })
          
          const catalogData = catalogResults.map(skuEntity => ({
            // SKU fields
            sku: skuEntity.sku,
            condition: skuEntity.conditionCode,
            language: skuEntity.languageCode,
            finish: skuEntity.finishCode,
            
            // Card fields (using correct camelCase property names)
            card_id: skuEntity.print?.card?.id,
            card_name: skuEntity.print?.card?.name,
            oracle_text: skuEntity.print?.card?.oracleText,
            flavor_text: skuEntity.print?.card?.flavorText,
            mana_cost: skuEntity.print?.card?.manaCost,
            mana_value: skuEntity.print?.card?.manaValue,
            colors: skuEntity.print?.card?.colors,
            power_value: skuEntity.print?.card?.powerValue,
            defense_value: skuEntity.print?.card?.defenseValue,
            hp: skuEntity.print?.card?.hp,
            primary_type: skuEntity.print?.card?.primaryType,
            subtypes: skuEntity.print?.card?.subtypes,
            
            // Print fields
            rarity: skuEntity.print?.rarity,
            artist: skuEntity.print?.artist,
            image_normal: skuEntity.print?.imageNormal,
            image_small: skuEntity.print?.imageSmall,
            
            // Set fields
            set_name: skuEntity.print?.set?.name,
            set_code: skuEntity.print?.set?.code,
            
            // Game fields
            game_code: skuEntity.print?.card?.game?.code,
            game_name: skuEntity.print?.card?.game?.name
          }))
          
          if (catalogData && catalogData.length > 0) {
            const data = catalogData[0]
            results[sku] = {
              valid: true,
              catalog_sku: data.sku,
              condition: data.condition,
              language: data.language,
              finish: data.finish,
              card: {
                id: data.card_id,
                name: data.card_name,
                oracle_text: data.oracle_text,
                flavor_text: data.flavor_text,
                mana_cost: data.mana_cost,
                mana_value: data.mana_value,
                colors: data.colors,
                power_value: data.power_value,
                defense_value: data.defense_value,
                hp: data.hp,
                primary_type: data.primary_type,
                subtypes: data.subtypes
              },
              print: {
                rarity: data.rarity,
                artist: data.artist,
                image_normal: data.image_normal,
                image_small: data.image_small
              },
              set: {
                name: data.set_name,
                code: data.set_code
              },
              game: {
                code: data.game_code,
                name: data.game_name
              }
            }
          } else {
            results[sku] = {
              valid: false,
              error: 'SKU not found in catalog'
            }
          }
        } catch (skuError) {
          results[sku] = {
            valid: false,
            error: 'Failed to validate SKU'
          }
        }
      }
      
      res.json({
        success: true,
        data: results,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.error('Error validating SKUs', error as Error)
      res.status(500).json({
        success: false,
        error: 'Failed to validate SKUs',
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      })
    }
  }
)

logger.info('Commerce integration routes loaded with inventory sync endpoints')

export default router
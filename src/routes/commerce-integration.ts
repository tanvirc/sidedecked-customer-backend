import { Router } from 'express'
// NOTE: Commerce integration routes are temporarily disabled until TCG catalog package is built
// import { body, param, query, validationResult } from 'express-validator'
// import { CommerceIntegrationService } from '../../../packages/tcg-catalog/src/services/CommerceIntegrationService'
// import { AppDataSource } from '../config/database'
// import { CatalogSKU } from '../../../packages/tcg-catalog/src/entities/CatalogSKU'
import { logger } from '../config/logger'

const router = Router()

// Placeholder routes - will be implemented once TCG catalog package is available
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Commerce integration endpoints will be available once TCG catalog package is built',
    endpoints: {
      'POST /match-product': 'Match vendor product to catalog',
      'POST /match-products-bulk': 'Bulk product matching',
      'POST /validate-sku': 'Validate single SKU',
      'POST /validate-skus-bulk': 'Bulk SKU validation',
      'POST /sync-inventory/:catalogSkuId': 'Sync inventory for SKU'
    }
  })
})

// TODO: Uncomment and implement these routes once packages/tcg-catalog is built:
/*
router.post('/match-product', async (req, res) => {
  // Product matching implementation
})

router.post('/match-products-bulk', async (req, res) => {
  // Bulk product matching implementation  
})

router.post('/validate-sku', async (req, res) => {
  // SKU validation implementation
})

router.post('/validate-skus-bulk', async (req, res) => {
  // Bulk SKU validation implementation
})

router.post('/sync-inventory/:catalogSkuId', async (req, res) => {
  // Inventory sync implementation
})
*/

logger.info('Commerce integration routes loaded (placeholder mode)')

export default router
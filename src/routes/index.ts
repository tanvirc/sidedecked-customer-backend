import { Router } from 'express'
import commerceIntegrationRoutes from './commerce-integration'

export const setupRoutes = (): Router => {
  const router = Router()

  // API version and info
  router.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'SideDecked Customer Backend API',
      version: '1.0.0',
      documentation: '/api/docs',
      endpoints: {
        catalog: '/api/catalog',
        decks: '/api/decks',
        community: '/api/community',
        pricing: '/api/pricing',
        commerce: '/api/commerce',
        admin: '/api/admin'
      }
    })
  })

  // Commerce integration routes (connects catalog to MercurJS)
  router.use('/commerce', commerceIntegrationRoutes)

  // TODO: Add remaining route modules
  // router.use('/catalog', catalogRoutes)
  // router.use('/decks', deckRoutes)
  // router.use('/community', communityRoutes)
  // router.use('/pricing', pricingRoutes)
  // router.use('/admin', adminRoutes)

  return router
}
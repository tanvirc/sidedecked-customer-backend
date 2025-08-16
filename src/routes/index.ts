import { Router } from 'express'
import commerceIntegrationRoutes from './commerce-integration'
import catalogRoutes from './catalog'
import wishlistRoutes from './wishlist'
import pricingRoutes from './pricing'
import sellersRoutes from './sellers'

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
        wishlists: '/api/wishlists',
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

  // Catalog routes (games, cards, search) - mounted directly under /api
  router.use('/', catalogRoutes)

  // Wishlist routes
  router.use('/wishlists', wishlistRoutes)

  // Pricing routes
  router.use('/pricing', pricingRoutes)

  // Seller routes
  router.use('/sellers', sellersRoutes)

  // TODO: Add remaining route modules
  // router.use('/decks', deckRoutes)
  // router.use('/community', communityRoutes)
  // router.use('/admin', adminRoutes)

  return router
}
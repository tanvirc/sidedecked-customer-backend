import { Router } from 'express'

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
        admin: '/api/admin'
      }
    })
  })

  // TODO: Add route modules
  // router.use('/catalog', catalogRoutes)
  // router.use('/decks', deckRoutes)
  // router.use('/community', communityRoutes)
  // router.use('/pricing', pricingRoutes)
  // router.use('/admin', adminRoutes)

  return router
}
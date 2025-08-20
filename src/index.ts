import 'reflect-metadata'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'

import { config, validateConfig } from './config/env'
import { initializeDatabase } from './config/database'
import { initializeInfrastructure, closeInfrastructure } from './config/infrastructure'
import { getServiceContainer } from './services/ServiceContainer'
import { setupRoutes } from './routes'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import { requestLogger } from './middleware/requestLogger'
import { jobScheduler } from './services/JobScheduler'

async function createApp(): Promise<express.Application> {
  const app = express()

  // Trust proxy (required for Railway and other reverse proxy deployments)
  if (config.NODE_ENV === 'production') {
    // Railway uses a single hop reverse proxy
    app.set('trust proxy', 1)
  }

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }))

  // CORS configuration
  app.use(cors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }))

  // Compression
  app.use(compression())

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
  })
  app.use(limiter)

  // Body parsing
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true, limit: '10mb' }))

  // Request logging
  app.use(requestLogger)

  // Lightweight ping endpoint for cold start detection (no service checks)
  app.get('/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // Comprehensive health check
  app.get('/health', async (req, res) => {
    try {
      const serviceContainer = getServiceContainer()
      const serviceHealth = await serviceContainer.healthCheckAll()
      
      res.json({
        status: serviceHealth.healthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: config.NODE_ENV,
        uptime: process.uptime(),
        services: serviceHealth.services
      })
    } catch (error) {
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: config.NODE_ENV,
        uptime: process.uptime(),
        error: (error as Error).message
      })
    }
  })

  // API routes
  app.use('/api', setupRoutes())

  // 404 handler
  app.use(notFoundHandler)

  // Error handler (must be last)
  app.use(errorHandler)

  return app
}

async function startServer(): Promise<void> {
  try {
    // Validate configuration
    validateConfig()
    console.log('✅ Configuration validated')

    // Initialize database
    await initializeDatabase()
    console.log('✅ Database initialized')
    
    // Debug: Check if pricing tables exist
    const { AppDataSource } = await import('./config/database')
    try {
      const tableCheck = await AppDataSource.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name IN ('market_prices', 'price_history')
        ORDER BY table_name
      `)
      console.log('🔍 Pricing tables check:', tableCheck.map((t: any) => t.table_name))
      
      if (tableCheck.length === 0) {
        console.log('❌ No pricing tables found - this explains the errors')
      } else {
        console.log('✅ Pricing tables exist, checking for data...')
        const marketPriceCount = await AppDataSource.query('SELECT COUNT(*) FROM market_prices')
        const priceHistoryCount = await AppDataSource.query('SELECT COUNT(*) FROM price_history')
        console.log(`📊 market_prices: ${marketPriceCount[0].count} rows`)
        console.log(`📊 price_history: ${priceHistoryCount[0].count} rows`)
      }
    } catch (error) {
      console.log('❌ Debug table check failed:', (error as Error).message)
    }

    // Initialize infrastructure (Redis, Algolia, etc.)
    await initializeInfrastructure()
    console.log('✅ Infrastructure initialized')

    // Initialize services
    const serviceContainer = getServiceContainer()
    await serviceContainer.initializeServices()
    console.log('✅ Services initialized')

    // Start background job scheduler
    jobScheduler.start()
    console.log('✅ Background job scheduler started')

    // Create Express app
    const app = await createApp()
    console.log('✅ Express app created')

    // Start server
    const server = app.listen(config.PORT, config.HOST, () => {
      console.log(`
🚀 SideDecked Customer Backend API Server Started

   Environment: ${config.NODE_ENV}
   Host:        ${config.HOST}
   Port:        ${config.PORT}
   URL:         http://${config.HOST}:${config.PORT}
   Health:      http://${config.HOST}:${config.PORT}/health

🗄️  Database:   ${config.DATABASE_URL.replace(/\/\/.*@/, '//***:***@')}
🔍 Search:     ${config.ALGOLIA_APP_ID ? 'Algolia configured' : 'Search not configured'}
📁 Storage:    ${config.MINIO_ENDPOINT || 'Not configured'}

Ready to serve TCG catalog, deck builder, community, and pricing APIs!
      `)
    })

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n⏹️  Received ${signal}. Starting graceful shutdown...`)
      
      server.close(async () => {
        console.log('✅ HTTP server closed')
        
        // Stop background job scheduler
        jobScheduler.stop()
        console.log('✅ Background job scheduler stopped')
        
        // Close services
        const serviceContainer = getServiceContainer()
        await serviceContainer.shutdown()
        
        // Close infrastructure
        await closeInfrastructure()
        
        // Close database connection
        const { closeDatabase } = await import('./config/database')
        await closeDatabase()
        
        console.log('✅ Graceful shutdown completed')
        process.exit(0)
      })
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  startServer()
}

export { createApp, startServer }
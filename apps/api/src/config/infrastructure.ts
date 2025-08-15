import { Client as MinioClient } from 'minio'
import Redis from 'ioredis'
import algoliasearch, { SearchClient } from 'algoliasearch'
import Queue from 'bull'
import { config } from './env'
// TODO: Import from @sidedecked/tcg-catalog when package is built
import { logger } from './logger'

// Redis connection
let redisClient: Redis | null = null

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      lazyConnect: true
    })

    redisClient.on('connect', () => {
      logger.info('Redis connected')
    })

    redisClient.on('error', (error) => {
      logger.error('Redis connection error', error)
    })

    redisClient.on('ready', () => {
      logger.info('Redis ready')
    })
  }

  return redisClient
}

// MinIO/Storage configuration
// TODO: Implement storage service when package is ready
export const getStorageService = () => {
  throw new Error('Storage service not yet implemented')
}

// Algolia configuration
let algoliaClient: SearchClient | null = null

export const getAlgoliaClient = (): SearchClient => {
  if (!algoliaClient) {
    if (!config.ALGOLIA_APP_ID || !config.ALGOLIA_API_KEY) {
      throw new Error('Algolia configuration is missing. Please set ALGOLIA_APP_ID and ALGOLIA_API_KEY')
    }

    algoliaClient = algoliasearch(config.ALGOLIA_APP_ID, config.ALGOLIA_API_KEY)
    
    logger.info('Algolia client initialized', {
      appId: config.ALGOLIA_APP_ID,
      indexCards: config.ALGOLIA_INDEX_CARDS,
      indexMarketplace: config.ALGOLIA_INDEX_MARKETPLACE
    })
  }

  return algoliaClient
}

// Bull Queue configurations
const queues = new Map<string, Queue.Queue>()

export const getQueue = (queueName: string, options?: Queue.QueueOptions): Queue.Queue => {
  if (!queues.has(queueName)) {
    const defaultOptions: Queue.QueueOptions = {
      redis: config.REDIS_URL,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }
    }

    const queue = new Queue(queueName, { ...defaultOptions, ...options })

    // Event logging
    queue.on('completed', (job) => {
      logger.debug('Queue job completed', {
        queue: queueName,
        jobId: job.id,
        duration: Date.now() - job.processedOn!
      })
    })

    queue.on('failed', (job, error) => {
      logger.error('Queue job failed', error, {
        queue: queueName,
        jobId: job.id,
        attempts: job.attemptsMade
      })
    })

    queue.on('stalled', (job) => {
      logger.warn('Queue job stalled', {
        queue: queueName,
        jobId: job.id
      })
    })

    queues.set(queueName, queue)
    
    logger.info('Queue initialized', { queueName })
  }

  return queues.get(queueName)!
}

// Specialized queue getters
export const getETLQueue = (): Queue.Queue => {
  return getQueue('tcg-etl', {
    defaultJobOptions: {
      removeOnComplete: 10,
      removeOnFail: 20,
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    }
  })
}

export const getImageQueue = (): Queue.Queue => {
  return getQueue('image-processing', {
    defaultJobOptions: {
      removeOnComplete: 50,
      removeOnFail: 25,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000
      }
    }
  })
}

export const getSearchIndexQueue = (): Queue.Queue => {
  return getQueue('search-indexing', {
    defaultJobOptions: {
      removeOnComplete: 20,
      removeOnFail: 10,
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 3000
      }
    }
  })
}

export const getPriceUpdateQueue = (): Queue.Queue => {
  return getQueue('price-update', {
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 25,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    }
  })
}

// Health check functions
export const checkRedisHealth = async (): Promise<{ healthy: boolean; error?: string }> => {
  try {
    const redis = getRedisClient()
    await redis.ping()
    return { healthy: true }
  } catch (error) {
    return { healthy: false, error: (error as Error).message }
  }
}

export const checkStorageHealth = async (): Promise<{ healthy: boolean; error?: string }> => {
  // TODO: Implement storage health check
  return { healthy: false, error: 'Storage service not implemented' }
}

export const checkAlgoliaHealth = async (): Promise<{ healthy: boolean; error?: string }> => {
  try {
    const algolia = getAlgoliaClient()
    const index = algolia.initIndex(config.ALGOLIA_INDEX_CARDS)
    
    // Simple search to check if Algolia is responding
    await index.search('', { hitsPerPage: 1 })
    return { healthy: true }
  } catch (error) {
    return { healthy: false, error: (error as Error).message }
  }
}

export const checkQueueHealth = async (queueName: string): Promise<{ healthy: boolean; error?: string }> => {
  try {
    const queue = getQueue(queueName)
    const stats = await queue.getJobCounts()
    
    // Queue is healthy if we can get stats
    return { healthy: true }
  } catch (error) {
    return { healthy: false, error: (error as Error).message }
  }
}

// Cleanup function for graceful shutdown
export const closeInfrastructure = async (): Promise<void> => {
  logger.info('Closing infrastructure connections...')

  // Close Redis
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    logger.info('Redis connection closed')
  }

  // Close queues
  for (const [name, queue] of queues) {
    await queue.close()
    logger.info('Queue closed', { queue: name })
  }
  queues.clear()

  // Note: MinIO client doesn't need explicit closing
  // Algolia client doesn't need explicit closing

  logger.info('All infrastructure connections closed')
}

// Initialize all infrastructure
export const initializeInfrastructure = async (): Promise<void> => {
  logger.info('Initializing infrastructure...')

  try {
    // Initialize Redis
    const redis = getRedisClient()
    await redis.ping()
    logger.info('Redis initialized')

    // TODO: Initialize storage
    logger.info('Storage initialization skipped (not implemented)')

    // Initialize Algolia (connection is lazy)
    getAlgoliaClient()
    logger.info('Algolia initialized')

    // Test queue initialization
    getETLQueue()
    getImageQueue()
    getSearchIndexQueue()
    getPriceUpdateQueue()
    logger.info('Queues initialized')

    logger.info('All infrastructure initialized successfully')
  } catch (error) {
    logger.error('Failed to initialize infrastructure', error as Error)
    throw error
  }
}
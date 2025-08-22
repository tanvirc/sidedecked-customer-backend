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
let minioClient: MinioClient | null = null

export const getMinioClient = (): MinioClient => {
  if (!minioClient) {
    if (!config.MINIO_ENDPOINT) {
      throw new Error('MinIO configuration is missing. Please set MINIO_ENDPOINT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY')
    }

    // Parse endpoint to remove protocol and extract port
    let endpoint = config.MINIO_ENDPOINT
    let port = 9000
    let useSSL = config.NODE_ENV === 'production'
    
    // Remove protocol if present
    if (endpoint.startsWith('https://')) {
      endpoint = endpoint.replace('https://', '')
      useSSL = true
      port = 443
    } else if (endpoint.startsWith('http://')) {
      endpoint = endpoint.replace('http://', '')
      useSSL = false
      port = 80
    }
    
    // Extract port if specified
    if (endpoint.includes(':')) {
      const parts = endpoint.split(':')
      endpoint = parts[0]
      port = parseInt(parts[1]) || port
    }

    minioClient = new MinioClient({
      endPoint: endpoint,
      port: port,
      useSSL: useSSL,
      accessKey: config.MINIO_ACCESS_KEY || '',
      secretKey: config.MINIO_SECRET_KEY || '',
      transportAgent: config.NODE_ENV === 'production' ? undefined : undefined,
      sessionToken: undefined,
      pathStyle: true, // Use path-style for Railway MinIO
      region: config.MINIO_REGION || 'us-east-1'
    })

    logger.info('MinIO client initialized', {
      endpoint: endpoint,
      port: port,
      useSSL: useSSL,
      bucket: config.MINIO_BUCKET
    })
  }

  return minioClient
}

export const getStorageService = () => {
  return {
    client: getMinioClient(),
    bucket: config.MINIO_BUCKET,
    
    async ensureBucket(): Promise<void> {
      const client = getMinioClient()
      const bucketName = config.MINIO_BUCKET
      
      try {
        // First check if we can list buckets (basic connectivity test)
        try {
          await client.listBuckets()
          logger.debug('MinIO connection successful')
        } catch (connectError) {
          logger.warn('MinIO connection test failed, continuing anyway', { error: (connectError as Error).message })
          // Don't throw here - allow the service to start without storage
          return
        }
        
        const exists = await client.bucketExists(bucketName)
        
        if (!exists) {
          await client.makeBucket(bucketName, config.MINIO_REGION)
          
          // Set bucket policy for public read access
          const policy = {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { AWS: ['*'] },
                Action: ['s3:GetObject'],
                Resource: [`arn:aws:s3:::${bucketName}/*`]
              }
            ]
          }
          
          await client.setBucketPolicy(bucketName, JSON.stringify(policy))
          logger.info('MinIO bucket created with public read access', { bucketName })
        } else {
          logger.info('MinIO bucket already exists', { bucketName })
        }
      } catch (error) {
        logger.error('Failed to ensure bucket exists', error as Error, { bucketName })
        // Don't throw - allow service to continue without storage
        logger.warn('Service will continue without storage functionality')
      }
    },
    
    getPublicUrl(key: string): string {
      // Always return MinIO URLs - CDN transformation happens at API layer
      const endpoint = config.MINIO_ENDPOINT || 'localhost:9000'
      const useSSL = config.NODE_ENV === 'production'
      const protocol = useSSL ? 'https' : 'http'
      
      // Handle endpoint that might already have protocol
      if (endpoint.startsWith('https://') || endpoint.startsWith('http://')) {
        return `${endpoint}/${config.MINIO_BUCKET}/${key}`
      }
      
      return `${protocol}://${endpoint}/${config.MINIO_BUCKET}/${key}`
    }
  }
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
  try {
    if (!config.MINIO_ENDPOINT || !config.MINIO_ACCESS_KEY || !config.MINIO_SECRET_KEY) {
      return { healthy: false, error: 'Storage configuration incomplete' }
    }
    
    const storage = getStorageService()
    
    // Add timeout to storage health check
    await Promise.race([
      storage.ensureBucket(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Storage health check timeout')), 5000)
      )
    ])
    
    return { healthy: true }
  } catch (error) {
    return { healthy: false, error: (error as Error).message }
  }
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

    // Initialize storage with timeout and completely non-blocking approach
    if (config.MINIO_ENDPOINT && config.MINIO_ACCESS_KEY && config.MINIO_SECRET_KEY) {
      // Start storage initialization in background - don't wait for it
      const initializeStorageAsync = async () => {
        try {
          // Set a longer timeout for Railway environment (30 seconds)
          const storage = getStorageService()
          const storageInitPromise = storage.ensureBucket()
          
          // Use Promise.race to implement a timeout - increased to 30 seconds for Railway
          await Promise.race([
            storageInitPromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Storage initialization timeout after 30 seconds')), 30000)
            )
          ])
          
          logger.info('Storage initialized successfully (background)')
        } catch (error) {
          logger.error('Storage initialization failed (background)', error as Error)
          logger.warn('Server will continue without storage - images may not load until storage is available')
          
          // Retry storage initialization after a delay if it fails
          setTimeout(() => {
            logger.info('Retrying storage initialization...')
            initializeStorageAsync().catch(err => {
              logger.error('Storage retry failed', err as Error)
            })
          }, 60000) // Retry after 1 minute
        }
      }
      
      // Start in background without blocking
      initializeStorageAsync()
      logger.info('Storage initialization started in background')
    } else {
      logger.warn('Storage configuration incomplete - skipping MinIO initialization')
    }

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
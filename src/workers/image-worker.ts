#!/usr/bin/env ts-node
/**
 * Image Processing Worker
 * 
 * This worker processes image jobs from the Bull queue, downloading card images,
 * converting them to WebP format, generating multiple sizes, and uploading to MinIO.
 * 
 * Usage:
 *   npm run worker:images
 *   tsx src/workers/image-worker.ts
 */

import { AppDataSource } from '../config/database'
import { getImageQueue, getStorageService } from '../config/infrastructure'
import { ImageQueueProcessor } from '../../packages/tcg-catalog/src/queues/ImageQueue'
import { ImageProcessingService } from '../../packages/tcg-catalog/src/services/ImageProcessingService'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'
import { config } from '../config/env'
import { Print } from '../entities/Print'
import { CardImage, ImageStatus, ImageType } from '../entities/CardImage'
import { cdnService } from '../services/CDNService'
import Queue from 'bull'

interface ImageProcessingJobData {
  printId: string
  imageUrls: {
    small?: string
    normal?: string
    large?: string
    artCrop?: string
    borderCrop?: string
    back?: string
  }
  urlMapping?: Record<string, string[]> // Maps normalized URLs to image types
  priority?: number
}

class ImageWorker {
  private queue: Queue.Queue<ImageProcessingJobData>
  private imageService: ImageProcessingService
  private isRunning: boolean = false
  private processedCount: number = 0
  private failedCount: number = 0

  constructor() {
    this.queue = getImageQueue()
    
    // Parse MinIO endpoint to extract host, port and SSL settings
    const minioEndpoint = config.MINIO_ENDPOINT || ''
    let endpoint = minioEndpoint
    let port = 9000
    let useSSL = false
    
    // Remove protocol and extract port
    if (endpoint.startsWith('https://')) {
      endpoint = endpoint.replace('https://', '')
      useSSL = true
      port = 443
    } else if (endpoint.startsWith('http://')) {
      endpoint = endpoint.replace('http://', '')
      useSSL = false
      port = 80
    }
    
    // Extract port if specified in endpoint
    if (endpoint.includes(':')) {
      const parts = endpoint.split(':')
      endpoint = parts[0]
      port = parseInt(parts[1]) || port
    }
    
    logger.info('MinIO configuration', {
      endpoint,
      port,
      useSSL,
      bucket: config.MINIO_BUCKET
    })
    
    // Initialize image processing service with MinIO config
    this.imageService = new ImageProcessingService({
      storageProvider: 'minio',
      bucket: config.MINIO_BUCKET,
      cdnBaseUrl: config.CDN_BASE_URL,
      enableWebP: true,
      enableBlurhash: true,
      compressionQuality: {
        thumbnail: 80,
        small: 85,
        normal: 90,
        large: 95,
        original: 100
      },
      sizes: {
        thumbnail: { width: 150, height: 209 },
        small: { width: 300, height: 418 },
        normal: { width: 488, height: 680 },
        large: { width: 672, height: 936 }
      },
      maxRetries: 3,
      retryDelayMs: 2000,
      minioEndpoint: endpoint,
      minioPort: port,
      minioUseSSL: useSSL,
      minioAccessKey: config.MINIO_ACCESS_KEY,
      minioSecretKey: config.MINIO_SECRET_KEY,
      minioBucketName: config.MINIO_BUCKET
    })
  }

  async start(): Promise<void> {
    logger.info('🎨 Starting image processing worker')
    
    // Initialize database
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize()
      logger.info('Database connection established')
    }
    
    // Ensure storage bucket exists
    const storage = getStorageService()
    await storage.ensureBucket()
    logger.info('Storage bucket verified')
    
    this.isRunning = true
    
    // Process image jobs with concurrency of 3
    this.queue.process('process-images', 3, async (job) => {
      return await this.processImageJob(job)
    })
    
    // Setup event handlers
    this.setupEventHandlers()
    
    // Log initial queue stats
    await this.logQueueStats()
    
    // Setup graceful shutdown
    this.setupGracefulShutdown()
    
    logger.info('✅ Image worker ready and processing jobs')
  }

  private async processImageJob(job: Queue.Job<ImageProcessingJobData>): Promise<any> {
    const { printId, imageUrls, urlMapping } = job.data
    const startTime = Date.now()
    
    // Calculate total image types (including duplicates that were deduplicated)
    const totalImageTypes = urlMapping 
      ? Object.values(urlMapping).reduce((sum, types) => sum + types.length, 0)
      : Object.keys(imageUrls).length
    
    logger.info('Processing optimized image job', {
      jobId: String(job.id),
      printId,
      uniqueImageCount: Object.keys(imageUrls).length,
      totalImageTypes,
      deduplicationApplied: !!urlMapping
    })
    
    try {
      // Get print and ensure it exists
      const printRepo = AppDataSource.getRepository(Print)
      const print = await printRepo.findOne({ where: { id: printId } })
      
      if (!print) {
        throw new Error(`Print not found: ${printId}`)
      }
      
      const processedImages: any[] = []
      const cardImageRepo = AppDataSource.getRepository(CardImage)
      
      // Process each unique image URL
      for (const [primaryImageType, imageUrl] of Object.entries(imageUrls)) {
        if (!imageUrl) continue
        
        try {
          // Normalize URL to find all image types this URL represents
          const normalizedUrl = this.normalizeImageUrl(imageUrl)
          const representedTypes = urlMapping?.[normalizedUrl] || [primaryImageType]
          
          logger.debug('Processing consolidated image', {
            printId,
            primaryImageType,
            imageUrl: imageUrl.substring(imageUrl.lastIndexOf('/') + 1, imageUrl.lastIndexOf('/') + 20) + '...',
            representedTypes
          })
          
          // Process the image once using consolidated storage paths
          const result = await this.imageService.processImageFromUrl(
            imageUrl,
            printId,
            primaryImageType // Still pass the primary type for processing
          )
          
          if (result.success) {
            // Create CardImage entities for ALL image types this URL represents
            for (const imageType of representedTypes) {
              let cardImage = await cardImageRepo.findOne({
                where: { 
                  printId,
                  imageType: this.mapImageType(imageType)
                }
              })
              
              // Create or update CardImage entity
              if (!cardImage) {
                cardImage = cardImageRepo.create({
                  printId,
                  imageType: this.mapImageType(imageType),
                  sourceUrl: imageUrl,
                  status: ImageStatus.COMPLETED
                })
              } else {
                cardImage.status = ImageStatus.COMPLETED
                cardImage.retryCount = (cardImage.retryCount || 0) + 1
              }
              
              // All image types point to the SAME consolidated storage URLs
              cardImage.storageUrls = result.urls as any
              cardImage.blurhash = result.blurhash || null
              cardImage.processedAt = new Date()
              cardImage.cdnUrls = null // Set at API layer
              
              await cardImageRepo.save(cardImage)
              
              // Update Print entity with image URLs for quick access
              if (imageType === 'normal') {
                print.imageNormal = result.urls?.normal || null
                print.imageSmall = result.urls?.small || null
                print.imageLarge = result.urls?.large || null
                print.blurhash = result.blurhash || null
              } else if (imageType === 'artCrop') {
                print.imageArtCrop = result.urls?.normal || null
              }
              
              processedImages.push({
                type: imageType,
                success: true,
                blurhash: result.blurhash,
                urls: result.urls,
                isSharedStorage: representedTypes.length > 1
              })
            }
            
            logger.info('Consolidated image processed successfully', {
              printId,
              primaryImageType,
              representedTypes,
              blurhash: result.blurhash?.substring(0, 16) + '...',
              storageShared: representedTypes.length > 1
            })
            
          } else {
            // Mark all represented image types as failed
            for (const imageType of representedTypes) {
              let cardImage = await cardImageRepo.findOne({
                where: { 
                  printId,
                  imageType: this.mapImageType(imageType)
                }
              })
              
              if (!cardImage) {
                cardImage = cardImageRepo.create({
                  printId,
                  imageType: this.mapImageType(imageType),
                  sourceUrl: imageUrl,
                  status: ImageStatus.FAILED
                })
              } else {
                cardImage.status = ImageStatus.FAILED
                cardImage.retryCount = (cardImage.retryCount || 0) + 1
              }
              
              cardImage.errorMessage = result.error || null
              await cardImageRepo.save(cardImage)
              
              processedImages.push({
                type: imageType,
                success: false,
                error: result.error
              })
            }
            
            logger.warn('Consolidated image processing failed', {
              printId,
              primaryImageType,
              representedTypes,
              error: result.error
            })
          }
          
          // Update job progress based on unique images processed
          const uniqueProcessed = Object.keys(imageUrls).indexOf(primaryImageType) + 1
          const progress = Math.round((uniqueProcessed / Object.keys(imageUrls).length) * 100)
          await job.progress(progress)
          
        } catch (error) {
          logger.error('Error processing consolidated image', error as Error, {
            printId,
            primaryImageType,
            imageUrl: imageUrl.substring(0, 50) + '...'
          })
          
          // Mark all represented types as failed
          const normalizedUrl = this.normalizeImageUrl(imageUrl)
          const representedTypes = urlMapping?.[normalizedUrl] || [primaryImageType]
          
          for (const imageType of representedTypes) {
            processedImages.push({
              type: imageType,
              success: false,
              error: (error as Error).message
            })
          }
        }
      }
      
      // Save print with updated image URLs
      await printRepo.save(print)
      
      const processingTime = Date.now() - startTime
      const successCount = processedImages.filter(img => img.success).length
      const failedCount = processedImages.filter(img => !img.success).length
      
      this.processedCount += successCount
      this.failedCount += failedCount
      
      logger.info('Optimized image job completed', {
        jobId: String(job.id),
        printId,
        uniqueImagesProcessed: Object.keys(imageUrls).length,
        totalImageTypesHandled: successCount + failedCount,
        successCount,
        failedCount,
        processingTime,
        efficiency: `${Math.round((totalImageTypes / Object.keys(imageUrls).length) * 100)}% deduplication`
      })
      
      return {
        printId,
        success: failedCount === 0,
        processedImages,
        totalProcessed: successCount,
        totalFailed: failedCount,
        processingTime,
        optimizationStats: {
          uniqueImagesProcessed: Object.keys(imageUrls).length,
          totalImageTypes: totalImageTypes,
          deduplicationRatio: Math.round((1 - Object.keys(imageUrls).length / totalImageTypes) * 100)
        }
      }
      
    } catch (error) {
      logger.error('Optimized image job failed', error as Error, {
        jobId: String(job.id),
        printId
      })
      
      this.failedCount++
      
      throw error
    }
  }

  private mapImageType(type: string): ImageType {
    switch (type) {
      case 'artCrop':
        return ImageType.ART_CROP
      case 'borderCrop':
        return ImageType.BORDER_CROP
      case 'back':
        return ImageType.BACK
      case 'thumbnail':
        return ImageType.THUMBNAIL
      case 'full':
        return ImageType.FULL
      default:
        return ImageType.MAIN
    }
  }

  private normalizeImageUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      // Keep only protocol, host, port, and pathname for comparison
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`
    } catch (error) {
      // If URL parsing fails, return original URL
      logger.warn('Failed to normalize image URL', { url })
      return url
    }
  }

  private setupEventHandlers(): void {
    this.queue.on('completed', (job, result) => {
      logger.debug('Job completed', {
        jobId: String(job.id),
        printId: result.printId,
        success: result.success
      })
    })
    
    this.queue.on('failed', (job, error) => {
      logger.error('Job failed', error, {
        jobId: String(job.id),
        printId: job.data?.printId,
        attempts: job.attemptsMade
      })
    })
    
    this.queue.on('stalled', (job) => {
      logger.warn('Job stalled', {
        jobId: String(job.id),
        printId: job.data?.printId
      })
    })
    
    this.queue.on('error', (error) => {
      logger.error('Queue error', error)
    })
  }

  private async logQueueStats(): Promise<void> {
    const logStats = async () => {
      if (!this.isRunning) return
      
      try {
        const counts = await this.queue.getJobCounts()
        const stats = {
          waiting: counts.waiting,
          active: counts.active,
          completed: counts.completed,
          failed: counts.failed,
          delayed: counts.delayed,
          processed: this.processedCount,
          failedTotal: this.failedCount
        }
        
        logger.info('📊 Queue statistics', stats)
      } catch (error) {
        logger.error('Failed to get queue stats', error as Error)
      }
    }
    
    // Log stats every minute
    setInterval(logStats, 60000)
    
    // Log initial stats
    await logStats()
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`)
      
      this.isRunning = false
      
      // Stop accepting new jobs
      await this.queue.pause()
      
      // Wait for active jobs to complete (max 30 seconds)
      const timeout = setTimeout(() => {
        logger.warn('Graceful shutdown timeout, forcing exit')
        process.exit(1)
      }, 30000)
      
      let activeCount = 0
      do {
        const counts = await this.queue.getJobCounts()
        activeCount = counts.active
        
        if (activeCount > 0) {
          logger.info(`Waiting for ${activeCount} active jobs to complete...`)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      } while (activeCount > 0)
      
      clearTimeout(timeout)
      
      // Close queue connection
      await this.queue.close()
      
      // Close database connection
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy()
      }
      
      logger.info('✅ Graceful shutdown complete')
      logger.info(`Final stats: Processed ${this.processedCount}, Failed ${this.failedCount}`)
      
      process.exit(0)
    }
    
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  }

  // Utility function to clean old completed/failed jobs
  async cleanOldJobs(olderThanHours: number = 24): Promise<void> {
    const olderThanMs = olderThanHours * 60 * 60 * 1000
    
    await this.queue.clean(olderThanMs, 'completed', 100)
    await this.queue.clean(olderThanMs, 'failed', 50)
    
    logger.info('Old jobs cleaned', { olderThanHours })
  }

  // Utility function to retry failed images
  async retryFailedImages(): Promise<void> {
    const cardImageRepo = AppDataSource.getRepository(CardImage)
    
    const failedImages = await cardImageRepo.find({
      where: {
        status: ImageStatus.FAILED,
        retryCount: 3 // Less than max retries
      },
      take: 100
    })
    
    logger.info(`Found ${failedImages.length} failed images to retry`)
    
    for (const image of failedImages) {
      await this.queue.add('process-images', {
        printId: image.printId,
        imageUrls: {
          [image.imageType]: image.sourceUrl
        },
        priority: 3 // Higher priority for retries
      })
      
      // Mark as retry
      image.status = ImageStatus.RETRY
      image.nextRetryAt = new Date(Date.now() + 60000) // Retry in 1 minute
      await cardImageRepo.save(image)
    }
    
    logger.info(`Queued ${failedImages.length} images for retry`)
  }
}

// Start the worker
if (require.main === module) {
  const worker = new ImageWorker()
  
  worker.start().catch(error => {
    logger.error('Failed to start image worker', error)
    process.exit(1)
  })
  
  // Setup periodic cleanup and retry
  setInterval(() => {
    worker.cleanOldJobs(48).catch(error => {
      logger.error('Failed to clean old jobs', error)
    })
  }, 6 * 60 * 60 * 1000) // Every 6 hours
  
  setInterval(() => {
    worker.retryFailedImages().catch(error => {
      logger.error('Failed to retry failed images', error)
    })
  }, 5 * 60 * 1000) // Every 5 minutes
}

export default ImageWorker
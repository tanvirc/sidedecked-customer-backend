import Queue from 'bull'
import { ImageProcessingService } from '../services/ImageProcessingService'
import { logger } from '../utils/Logger'
import { ImageProcessingConfig } from '../types/ImageTypes'

export interface ImageProcessingJob {
  printId: string
  imageUrls: {
    small?: string
    normal?: string
    large?: string
    artCrop?: string
  }
  priority?: number
}

export interface ImageProcessingJobResult {
  printId: string
  success: boolean
  processedImages: Array<{
    type: string
    success: boolean
    error?: string
    blurhash?: string
    urls?: Record<string, string>
  }>
  totalProcessed: number
  totalFailed: number
  processingTime: number
}

export class ImageQueueProcessor {
  private imageService: ImageProcessingService
  private queue: Queue.Queue<ImageProcessingJob>

  constructor(queue: Queue.Queue<ImageProcessingJob>, imageConfig: ImageProcessingConfig) {
    this.queue = queue
    this.imageService = new ImageProcessingService(imageConfig)
    
    this.setupQueueProcessors()
    this.setupQueueEvents()
  }

  /**
   * Add image processing job to queue
   */
  async addImageProcessingJob(
    job: ImageProcessingJob, 
    options?: Queue.JobOptions
  ): Promise<Queue.Job<ImageProcessingJob>> {
    const defaultOptions: Queue.JobOptions = {
      priority: job.priority || 5,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: 50,
      removeOnFail: 25
    }

    logger.info('Adding image processing job to queue', {
      printId: job.printId,
      imageCount: Object.keys(job.imageUrls).length,
      priority: job.priority
    })

    return await this.queue.add('process-images', job, {
      ...defaultOptions,
      ...options
    })
  }

  /**
   * Setup queue processors
   */
  private setupQueueProcessors(): void {
    // Main image processing processor
    this.queue.process('process-images', 5, async (job) => {
      return await this.processImages(job.data)
    })

    // Priority processor for high-priority images
    this.queue.process('process-images-priority', 2, async (job) => {
      return await this.processImages(job.data)
    })

    logger.info('Image queue processors configured', {
      processors: ['process-images (concurrency: 5)', 'process-images-priority (concurrency: 2)']
    })
  }

  /**
   * Setup queue event handlers
   */
  private setupQueueEvents(): void {
    this.queue.on('completed', (job, result: ImageProcessingJobResult) => {
      logger.info('Image processing job completed', {
        jobId: String(job.id),
        printId: result.printId,
        totalProcessed: result.totalProcessed,
        totalFailed: result.totalFailed,
        processingTime: result.processingTime
      })
    })

    this.queue.on('failed', (job, error) => {
      logger.error('Image processing job failed', error, {
        jobId: String(job.id),
        printId: job.data?.printId,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts
      })
    })

    this.queue.on('stalled', (job) => {
      logger.warn('Image processing job stalled', {
        jobId: String(job.id),
        printId: job.data?.printId
      })
    })

    this.queue.on('progress', (job, progress) => {
      if (progress % 25 === 0) { // Log every 25% progress
        logger.debug('Image processing job progress', {
          jobId: String(job.id),
          printId: job.data?.printId,
          progress: `${progress}%`
        })
      }
    })
  }

  /**
   * Process images for a print
   */
  private async processImages(jobData: ImageProcessingJob): Promise<ImageProcessingJobResult> {
    const startTime = Date.now()
    const { printId, imageUrls } = jobData
    
    logger.info('Starting image processing', {
      printId,
      imageTypes: Object.keys(imageUrls),
      imageCount: Object.keys(imageUrls).length
    })

    const result: ImageProcessingJobResult = {
      printId,
      success: true,
      processedImages: [],
      totalProcessed: 0,
      totalFailed: 0,
      processingTime: 0
    }

    let currentProgress = 0
    const totalImages = Object.keys(imageUrls).length

    // Process each image type
    for (const [imageType, imageUrl] of Object.entries(imageUrls)) {
      if (!imageUrl) {
        continue
      }

      try {
        logger.debug('Processing image', { printId, imageType, imageUrl })

        const processingResult = await this.imageService.processImageFromUrl(
          imageUrl,
          printId,
          imageType
        )

        if (processingResult.success) {
          result.processedImages.push({
            type: imageType,
            success: true,
            blurhash: processingResult.blurhash,
            urls: processingResult.urls
          })
          result.totalProcessed++

          logger.debug('Image processed successfully', {
            printId,
            imageType,
            blurhash: processingResult.blurhash?.substring(0, 16) + '...'
          })
        } else {
          result.processedImages.push({
            type: imageType,
            success: false,
            error: processingResult.error
          })
          result.totalFailed++
          result.success = false

          logger.warn('Image processing failed', {
            printId,
            imageType,
            error: processingResult.error
          })
        }

      } catch (error) {
        result.processedImages.push({
          type: imageType,
          success: false,
          error: (error as Error).message
        })
        result.totalFailed++
        result.success = false

        logger.error('Image processing error', error as Error, {
          printId,
          imageType,
          imageUrl
        })
      }

      // Update progress
      currentProgress++
      const progressPercent = Math.round((currentProgress / totalImages) * 100)
      
      // Note: In a real Bull queue, you'd call job.progress(progressPercent)
      // For now, we'll just log the progress
      logger.debug('Image processing progress', {
        printId,
        progress: progressPercent,
        processed: currentProgress,
        total: totalImages
      })
    }

    result.processingTime = Date.now() - startTime

    if (result.totalFailed > 0) {
      logger.warn('Image processing completed with failures', {
        printId,
        totalProcessed: result.totalProcessed,
        totalFailed: result.totalFailed,
        processingTime: result.processingTime
      })
    } else {
      logger.info('Image processing completed successfully', {
        printId,
        totalProcessed: result.totalProcessed,
        processingTime: result.processingTime
      })
    }

    return result
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
    paused: number
  }> {
    const counts = await this.queue.getJobCounts()
    return {
      waiting: counts.waiting,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      paused: 0 // Bull v3 doesn't have paused count, set to 0
    }
  }

  /**
   * Clean up completed and failed jobs
   */
  async cleanQueue(olderThanHours: number = 24): Promise<void> {
    const olderThanMs = olderThanHours * 60 * 60 * 1000
    
    await this.queue.clean(olderThanMs, 'completed', 100)
    await this.queue.clean(olderThanMs, 'failed', 50)
    
    logger.info('Queue cleanup completed', {
      olderThanHours,
      removedTypes: ['completed', 'failed']
    })
  }

  /**
   * Pause queue processing
   */
  async pauseQueue(): Promise<void> {
    await this.queue.pause()
    logger.info('Image processing queue paused')
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(): Promise<void> {
    await this.queue.resume()
    logger.info('Image processing queue resumed')
  }

  /**
   * Close the queue
   */
  async close(): Promise<void> {
    await this.queue.close()
    logger.info('Image processing queue closed')
  }

  /**
   * Health check for the queue
   */
  async healthCheck(): Promise<{ healthy: boolean; error?: string; stats?: any }> {
    try {
      const stats = await this.getQueueStats()
      
      // Check if queue is healthy (not too many failed jobs)
      const failedRatio = stats.failed / (stats.completed + stats.failed + 1)
      
      if (failedRatio > 0.5) {
        return {
          healthy: false,
          error: `High failure rate: ${Math.round(failedRatio * 100)}%`,
          stats
        }
      }

      return { healthy: true, stats }

    } catch (error) {
      return {
        healthy: false,
        error: (error as Error).message
      }
    }
  }
}
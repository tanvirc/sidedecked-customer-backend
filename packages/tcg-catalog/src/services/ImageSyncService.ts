import { AppDataSource } from '../../../../src/config/database'
import { Print } from '../../../../src/entities/Print'
import { CardImage, ImageStatus } from '../../../../src/entities/CardImage'
import { Game } from '../../../../src/entities/Game'
import { getImageQueue } from '../../../../src/config/infrastructure'
import { logger } from '../utils/Logger'
import { In, IsNull, Not } from 'typeorm'

export interface ImageSyncConfig {
  gameCode?: string
  batchSize?: number
  dryRun?: boolean
  forceReprocess?: boolean
  maxRetries?: number
}

export interface ImageSyncResult {
  success: boolean
  totalPrintsScanned: number
  printsNeedingImages: number
  imagesQueued: number
  errors: string[]
  duration: number
  gameBreakdown: Record<string, {
    printsScanned: number
    printsNeedingImages: number
    imagesQueued: number
  }>
}

export interface PrintImageNeed {
  printId: string
  cardName: string
  gameCode: string
  reason: 'missing_images' | 'external_urls' | 'failed_processing' | 'pending_processing'
  imageUrls: {
    small?: string
    normal?: string
    large?: string
    artCrop?: string
  }
}

export class ImageSyncService {
  private config: ImageSyncConfig

  constructor(config: ImageSyncConfig = {}) {
    this.config = {
      batchSize: config.batchSize || 100,
      dryRun: config.dryRun || false,
      forceReprocess: config.forceReprocess || false,
      maxRetries: config.maxRetries || 3,
      ...config
    }
  }

  /**
   * Main sync method - finds and queues images that need processing
   */
  async syncImages(): Promise<ImageSyncResult> {
    const startTime = Date.now()
    
    logger.info('🖼️ Starting image synchronization', {
      gameCode: this.config.gameCode || 'ALL',
      dryRun: this.config.dryRun,
      forceReprocess: this.config.forceReprocess
    })

    const result: ImageSyncResult = {
      success: true,
      totalPrintsScanned: 0,
      printsNeedingImages: 0,
      imagesQueued: 0,
      errors: [],
      duration: 0,
      gameBreakdown: {}
    }

    try {
      // Get games to process
      const games = await this.getGamesToProcess()
      
      for (const game of games) {
        logger.info(`Processing images for ${game.name} (${game.code})`)
        
        const gameResult = await this.syncImagesForGame(game)
        
        result.totalPrintsScanned += gameResult.printsScanned
        result.printsNeedingImages += gameResult.printsNeedingImages
        result.imagesQueued += gameResult.imagesQueued
        result.gameBreakdown[game.code] = gameResult
        
        logger.info(`Completed ${game.code}`, gameResult)
      }

      result.duration = Date.now() - startTime
      
      logger.info('🎉 Image synchronization completed', {
        totalPrintsScanned: result.totalPrintsScanned,
        printsNeedingImages: result.printsNeedingImages,
        imagesQueued: result.imagesQueued,
        dryRun: this.config.dryRun,
        duration: result.duration
      })

    } catch (error) {
      result.success = false
      result.errors.push((error as Error).message)
      
      logger.error('Image synchronization failed', error as Error)
    }

    return result
  }

  /**
   * Sync images for a specific game
   */
  private async syncImagesForGame(game: Game): Promise<{
    printsScanned: number
    printsNeedingImages: number
    imagesQueued: number
  }> {
    const gameResult = {
      printsScanned: 0,
      printsNeedingImages: 0,
      imagesQueued: 0
    }

    let offset = 0
    let hasMore = true

    while (hasMore) {
      // Get batch of prints for this game
      const prints = await this.getPrintsForGame(game.id, offset, this.config.batchSize!)
      
      if (prints.length === 0) {
        hasMore = false
        continue
      }

      gameResult.printsScanned += prints.length

      // Analyze which prints need image processing
      const printsNeedingImages = await this.analyzePrintsForImageNeeds(prints)
      gameResult.printsNeedingImages += printsNeedingImages.length

      if (!this.config.dryRun && printsNeedingImages.length > 0) {
        // Queue images for processing
        const queuedCount = await this.queueImagesForProcessing(printsNeedingImages)
        gameResult.imagesQueued += queuedCount
      }

      logger.debug(`Processed batch for ${game.code}`, {
        offset,
        batchSize: prints.length,
        needingImages: printsNeedingImages.length,
        queued: this.config.dryRun ? 0 : printsNeedingImages.length
      })

      offset += this.config.batchSize!
      
      // Break if we got less than a full batch
      if (prints.length < this.config.batchSize!) {
        hasMore = false
      }
    }

    return gameResult
  }

  /**
   * Get games to process based on config
   */
  private async getGamesToProcess(): Promise<Game[]> {
    const gameRepository = AppDataSource.getRepository(Game)
    
    if (this.config.gameCode) {
      const game = await gameRepository.findOne({
        where: { code: this.config.gameCode }
      })
      return game ? [game] : []
    }

    return await gameRepository.find({
      where: { etlEnabled: true },
      order: { code: 'ASC' }
    })
  }

  /**
   * Get prints for a specific game with pagination
   */
  private async getPrintsForGame(gameId: string, offset: number, limit: number): Promise<Print[]> {
    const printRepository = AppDataSource.getRepository(Print)
    
    return await printRepository.find({
      where: {
        card: { gameId: gameId }
      },
      relations: ['card', 'card.game'],
      skip: offset,
      take: limit,
      order: { createdAt: 'ASC' }
    })
  }

  /**
   * Analyze prints to determine which need image processing
   */
  private async analyzePrintsForImageNeeds(prints: Print[]): Promise<PrintImageNeed[]> {
    const printsNeedingImages: PrintImageNeed[] = []

    for (const print of prints) {
      const imageNeed = await this.analyzePrintImageNeed(print)
      if (imageNeed) {
        printsNeedingImages.push(imageNeed)
      }
    }

    return printsNeedingImages
  }

  /**
   * Analyze a single print to determine if it needs image processing
   */
  private async analyzePrintImageNeed(print: Print): Promise<PrintImageNeed | null> {
    const cardName = print.card?.name || 'Unknown'
    const gameCode = print.card?.game?.code || 'Unknown'

    // Check if print has no processed images at all
    if (!print.imageNormal && !print.imageSmall && !print.imageLarge) {
      return {
        printId: print.id,
        cardName,
        gameCode,
        reason: 'missing_images',
        imageUrls: {} // Will need to extract from source data
      }
    }

    // Check if images are still external URLs (not processed)
    if (this.isExternalImageUrl(print.imageNormal) || 
        this.isExternalImageUrl(print.imageSmall) || 
        this.isExternalImageUrl(print.imageLarge)) {
      
      return {
        printId: print.id,
        cardName,
        gameCode,
        reason: 'external_urls',
        imageUrls: {
          small: print.imageSmall || undefined,
          normal: print.imageNormal || undefined,
          large: print.imageLarge || undefined,
          artCrop: print.imageArtCrop || undefined
        }
      }
    }

    // Check CardImage table for failed/pending processing
    if (this.config.forceReprocess) {
      const cardImageRepo = AppDataSource.getRepository(CardImage)
      const failedImages = await cardImageRepo.find({
        where: {
          printId: print.id,
          status: In([ImageStatus.FAILED, ImageStatus.PENDING, ImageStatus.RETRY])
        }
      })

      if (failedImages.length > 0) {
        return {
          printId: print.id,
          cardName,
          gameCode,
          reason: 'failed_processing',
          imageUrls: {
            small: print.imageSmall || undefined,
            normal: print.imageNormal || undefined,
            large: print.imageLarge || undefined,
            artCrop: print.imageArtCrop || undefined
          }
        }
      }
    }

    return null
  }

  /**
   * Check if URL is external (not processed by our system)
   */
  private isExternalImageUrl(url: string | null): boolean {
    if (!url) return false

    // Check for common external domains
    const externalDomains = [
      'scryfall.io',
      'pokemontcg.io',
      'ygoprodeck.com',
      'optcgapi.com'
    ]

    return externalDomains.some(domain => url.includes(domain))
  }

  /**
   * Queue images for processing
   */
  private async queueImagesForProcessing(printsNeedingImages: PrintImageNeed[]): Promise<number> {
    const imageQueue = getImageQueue()
    let queuedCount = 0

    for (const printNeed of printsNeedingImages) {
      try {
        // Only queue if we have valid image URLs
        if (Object.keys(printNeed.imageUrls).length > 0) {
          await imageQueue.add('process-images', {
            printId: printNeed.printId,
            imageUrls: printNeed.imageUrls,
            priority: 5 // Normal priority
          }, {
            attempts: this.config.maxRetries,
            backoff: {
              type: 'exponential',
              delay: 2000
            }
          })

          queuedCount++

          logger.debug('Queued images for processing', {
            printId: printNeed.printId,
            cardName: printNeed.cardName,
            reason: printNeed.reason,
            imageCount: Object.keys(printNeed.imageUrls).length
          })
        }
      } catch (error) {
        logger.error('Failed to queue image for processing', error as Error, {
          printId: printNeed.printId,
          cardName: printNeed.cardName
        })
      }
    }

    return queuedCount
  }

  /**
   * Get sync status report
   */
  async getSyncStatus(): Promise<{
    totalPrints: number
    printsWithImages: number
    printsWithExternalImages: number
    printsWithoutImages: number
    failedImageProcessing: number
    pendingImageProcessing: number
  }> {
    const printRepository = AppDataSource.getRepository(Print)
    const cardImageRepository = AppDataSource.getRepository(CardImage)

    const [
      totalPrints,
      printsWithImages,
      printsWithExternalImages,
      printsWithoutImages,
      failedImageProcessing,
      pendingImageProcessing
    ] = await Promise.all([
      // Total prints
      printRepository.count(),
      
      // Prints with processed images (assume MinIO URLs contain our domain)
      printRepository.count({
        where: {
          imageNormal: Not(IsNull())
        }
      }),
      
      // Prints with external images
      printRepository.createQueryBuilder('print')
        .where('print.imageNormal LIKE :scryfall OR print.imageNormal LIKE :pokemon OR print.imageNormal LIKE :yugioh', {
          scryfall: '%scryfall.io%',
          pokemon: '%pokemontcg.io%', 
          yugioh: '%ygoprodeck.com%'
        })
        .getCount(),
      
      // Prints without any images
      printRepository.count({
        where: {
          imageNormal: IsNull(),
          imageSmall: IsNull(),
          imageLarge: IsNull()
        }
      }),
      
      // Failed image processing
      cardImageRepository.count({
        where: { status: ImageStatus.FAILED }
      }),
      
      // Pending image processing
      cardImageRepository.count({
        where: { status: In([ImageStatus.PENDING, ImageStatus.PROCESSING, ImageStatus.RETRY]) }
      })
    ])

    return {
      totalPrints,
      printsWithImages,
      printsWithExternalImages,
      printsWithoutImages,
      failedImageProcessing,
      pendingImageProcessing
    }
  }
}
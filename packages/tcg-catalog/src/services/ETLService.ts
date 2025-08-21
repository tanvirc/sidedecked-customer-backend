import { AppDataSource } from '../../../../src/config/database'
import { Game } from '../../../../src/entities/Game'
import { Card } from '../../../../src/entities/Card'
import { Print } from '../../../../src/entities/Print'
import { CardSet } from '../../../../src/entities/CardSet'
import { CatalogSKU } from '../../../../src/entities/CatalogSKU'
import { ETLJob, ETLJobStatus, ETLJobType } from '../../../../src/entities/ETLJob'
import { 
  ETLConfig, 
  ETLResult, 
  ETLError, 
  UniversalCard, 
  CircuitBreakerState,
  ImportCheckpoint,
  CardImportResult,
  BatchImportResult,
  ImageProcessingStatus,
  CardLevelCircuitBreakerState,
  CircuitBreakerType,
  CircuitBreakerConfig
} from '../types/ETLTypes'
import { logger, logTiming } from '../utils/Logger'
import { generateOracleHash, generatePrintHash, formatSKU, chunkArray } from '../utils/Helpers'
import { GAME_CODES, ETL_CONFIG } from '../utils/Constants'
import { 
  ScryfallTransformer, 
  PokemonTransformer, 
  YugiohTransformer, 
  OnePieceTransformer 
} from '../transformers'
import { getImageQueue } from '../../../../src/config/infrastructure'
import { ImageSyncService } from './ImageSyncService'

/**
 * ETL Service for importing card data from external APIs
 * 
 * IMAGE PROCESSING HIERARCHY:
 * - normal/large/small: Full card images (ALWAYS use for main display)
 * - artCrop: Artwork only (NEVER use for main display) 
 * - Processing order ensures full card images take priority over artwork
 */
export class ETLService {
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()
  private cardLevelCircuitBreakers: Map<string, CardLevelCircuitBreakerState> = new Map()
  private config: ETLConfig

  constructor(config?: Partial<ETLConfig>) {
    this.config = {
      batchSize: config?.batchSize || ETL_CONFIG.DEFAULT_BATCH_SIZE,
      rateLimitDelay: config?.rateLimitDelay || ETL_CONFIG.DEFAULT_RATE_LIMIT_DELAY,
      concurrency: config?.concurrency || ETL_CONFIG.DEFAULT_CONCURRENCY,
      skipImages: config?.skipImages || false,
      forceUpdate: config?.forceUpdate || false,
      maxRetries: config?.maxRetries || ETL_CONFIG.MAX_RETRIES,
      circuitBreakerThreshold: config?.circuitBreakerThreshold || ETL_CONFIG.CIRCUIT_BREAKER_THRESHOLD,
      circuitBreakerResetTimeout: config?.circuitBreakerResetTimeout || ETL_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT
    }
  }

  /**
   * Start ETL job for a specific game
   */
  async startETLJob(
    gameCode: string, 
    jobType: ETLJobType,
    triggeredBy: string = 'manual',
    limit?: number
  ): Promise<ETLResult> {
    const jobId = await this.createETLJob(gameCode, jobType, triggeredBy)
    
    try {
      logger.etlStarted(jobId, gameCode, jobType)
      
      // Check circuit breaker
      if (this.isCircuitBreakerOpen(gameCode)) {
        throw new Error(`Circuit breaker is open for ${gameCode}`)
      }

      const game = await this.getGame(gameCode)
      if (!game) {
        throw new Error(`Game not found: ${gameCode}`)
      }

      const result = await this.processETLJob(jobId, game, jobType, limit)
      
      await this.completeETLJob(jobId, result)
      logger.etlCompleted(jobId, gameCode, result)
      
      return result
    } catch (error) {
      await this.failETLJob(jobId, error as Error)
      logger.etlFailed(jobId, gameCode, error as Error)
      
      // Update circuit breaker
      this.recordFailure(gameCode)
      
      throw error
    }
  }

  /**
   * Process cards in batches with robust error handling
   */
  private async processETLJob(
    jobId: string,
    game: Game,
    jobType: ETLJobType,
    limit?: number
  ): Promise<ETLResult> {
    const startTime = Date.now()
    const result: ETLResult = {
      success: true,
      gameCode: game.code,
      totalProcessed: 0,
      cardsCreated: 0,
      cardsUpdated: 0,
      cardsDeleted: 0,
      printsCreated: 0,
      printsUpdated: 0,
      imagesQueued: 0,
      skusGenerated: 0,
      duration: 0,
      errors: [],
      // Enhanced card-level tracking
      cardResults: [],
      batchResults: [],
      cardsSkipped: 0,
      cardsRetried: 0,
      imageProcessingCompleted: 0,
      imageProcessingFailed: 0
    }

    // Track statistics for comprehensive summary
    let cardsSkipped = 0
    let setsCreated = 0

    try {
      // Handle IMAGE_SYNC job type separately
      if (jobType === ETLJobType.IMAGE_SYNC) {
        return await this.processImageSyncJob(jobId, game, result, startTime)
      }

      // Get data from external API
      const dataTransformer = this.getDataTransformer(game.apiProvider!)
      const cards = await dataTransformer.fetchCards(game, jobType, limit)
      
      result.totalProcessed = cards.length
      
      // Log expectations - what we're about to process
      logger.etlExpectations(
        game.code, 
        cards.length, 
        `API call for ${jobType} with limit ${limit || 'unlimited'}`,
        jobId
      )
      
      await this.updateETLJobProgress(jobId, 0, cards.length)

      // Process in batches
      const batches = chunkArray(cards, this.config.batchSize)
      
      // Initialize enhanced tracking arrays
      const allCardResults: CardImportResult[] = []
      const allBatchResults: BatchImportResult[] = []
      let totalImagesCompleted = 0
      let totalImagesFailed = 0
      let totalRetried = 0

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        
        try {
          const batchResult = await this.processBatch(batch, game, jobId)
          allBatchResults.push(batchResult)
          allCardResults.push(...batchResult.cardResults)
          
          // Aggregate results from the new batch system
          result.cardsCreated += batchResult.cardResults.filter(r => r.success && !r.isUpdate).length
          result.cardsUpdated += batchResult.cardResults.filter(r => r.success && r.isUpdate).length
          result.printsCreated += batchResult.cardResults.reduce((sum, r) => sum + r.printsCreated, 0)
          result.printsUpdated += batchResult.cardResults.reduce((sum, r) => sum + r.printsUpdated, 0)
          result.skusGenerated += batchResult.cardResults.reduce((sum, r) => sum + r.skusGenerated, 0)
          result.imagesQueued += batchResult.cardResults.reduce((sum, r) => sum + r.imagesQueued, 0)
          cardsSkipped += batchResult.skippedCards
          
          // Add batch errors to main error list
          result.errors.push(...batchResult.errors)
          
          // Track image processing status
          totalImagesCompleted += batchResult.cardResults.filter(r => 
            r.imageProcessingStatus === ImageProcessingStatus.COMPLETED || 
            r.imageProcessingStatus === ImageProcessingStatus.QUEUED
          ).length
          totalImagesFailed += batchResult.cardResults.filter(r => 
            r.imageProcessingStatus === ImageProcessingStatus.FAILED
          ).length
          
          // Track retries
          totalRetried += batchResult.cardResults.filter(r => r.retryCount > 0).length
          
          // Update progress
          const processed = (i + 1) * this.config.batchSize
          await this.updateETLJobProgress(jobId, processed, cards.length)
          
          logger.etlProgress(jobId, processed, cards.length)
          
          // Log batch summary with retry information
          const batchRetriedCards = batchResult.cardResults.filter(r => r.retryCount > 0).length
          const batchMaxRetries = Math.max(0, ...batchResult.cardResults.map(r => r.retryCount))
          
          logger.info(`Batch ${i + 1}/${batches.length} completed`, {
            jobId,
            successful: batchResult.successfulCards,
            failed: batchResult.failedCards,
            skipped: batchResult.skippedCards,
            retried: batchRetriedCards,
            maxRetryCount: batchMaxRetries,
            processingTime: batchResult.batchProcessingTimeMs
          })
          
          // Rate limiting between batches
          if (this.config.rateLimitDelay > 0) {
            await this.sleep(this.config.rateLimitDelay)
          }
          
        } catch (error) {
          const etlError: ETLError = {
            type: 'database_error',
            message: `Batch ${i + 1} failed: ${(error as Error).message}`,
            details: { batch: i + 1, batchSize: batch.length },
            timestamp: new Date(),
            retryable: true
          }
          
          result.errors.push(etlError)
          logger.error('ETL batch failed', error as Error, { jobId, batch: i + 1 })
        }
      }

      // Set enhanced tracking results
      result.cardResults = allCardResults
      result.batchResults = allBatchResults
      result.cardsSkipped = cardsSkipped
      result.cardsRetried = totalRetried
      result.imageProcessingCompleted = totalImagesCompleted
      result.imageProcessingFailed = totalImagesFailed
      
      result.duration = Date.now() - startTime
      result.success = result.errors.length === 0
      
      // Log comprehensive summary
      logger.etlSummary(game.code, {
        expected: result.totalProcessed,
        imported: result.cardsCreated,
        updated: result.cardsUpdated,
        skipped: cardsSkipped,
        failed: result.errors.length,
        printsCreated: result.printsCreated,
        setsCreated: setsCreated,
        skusGenerated: result.skusGenerated,
        duration: result.duration
      }, jobId)
      
      return result
      
    } catch (error) {
      result.success = false
      result.duration = Date.now() - startTime
      result.errors.push({
        type: 'api_error',
        message: (error as Error).message,
        timestamp: new Date(),
        retryable: false
      })
      
      throw error
    }
  }

  /**
   * Process IMAGE_SYNC job to find and queue unprocessed images
   */
  private async processImageSyncJob(
    jobId: string,
    game: Game,
    result: ETLResult,
    startTime: number
  ): Promise<ETLResult> {
    try {
      logger.info(`🖼️ Starting image sync for ${game.code}`, { jobId })

      // Create ImageSyncService for this specific game
      const imageSyncService = new ImageSyncService({
        gameCode: game.code,
        batchSize: this.config.batchSize,
        dryRun: false,
        forceReprocess: this.config.forceUpdate,
        maxRetries: this.config.maxRetries
      })

      // Run image synchronization
      const syncResult = await imageSyncService.syncImages()

      // Map ImageSyncResult to ETLResult
      result.totalProcessed = syncResult.totalPrintsScanned
      result.imagesQueued = syncResult.imagesQueued
      result.duration = Date.now() - startTime
      result.success = syncResult.success

      // Add any errors from sync
      if (syncResult.errors.length > 0) {
        result.errors = syncResult.errors.map(error => ({
          type: 'image_error',
          message: error,
          timestamp: new Date(),
          retryable: true
        }))
      }

      // Update job progress (image sync is considered complete once queued)
      await this.updateETLJobProgress(jobId, result.totalProcessed, result.totalProcessed)

      // Log comprehensive summary for image sync
      logger.etlSummary(game.code, {
        expected: result.totalProcessed,
        imported: 0, // No cards imported during image sync
        updated: 0,
        skipped: result.totalProcessed - syncResult.printsNeedingImages,
        failed: result.errors.length,
        printsCreated: 0,
        setsCreated: 0,
        skusGenerated: 0,
        duration: result.duration
      }, jobId)

      logger.info(`✅ Image sync completed for ${game.code}`, {
        jobId,
        printsScanned: syncResult.totalPrintsScanned,
        printsNeedingImages: syncResult.printsNeedingImages,
        imagesQueued: syncResult.imagesQueued,
        duration: result.duration
      })

      return result

    } catch (error) {
      result.success = false
      result.duration = Date.now() - startTime
      result.errors.push({
        type: 'image_error',
        message: (error as Error).message,
        timestamp: new Date(),
        retryable: false
      })

      logger.error(`❌ Image sync failed for ${game.code}`, error as Error, { jobId })
      throw error
    }
  }

  /**
   * Process a single card atomically with its own transaction
   */
  private async processCardAtomically(
    cardData: UniversalCard, 
    game: Game, 
    jobId?: string
  ): Promise<CardImportResult> {
    const startTime = Date.now()
    const result: CardImportResult = {
      cardName: cardData.name,
      oracleId: cardData.oracleId,
      oracleHash: cardData.oracleHash || 'pending',
      success: false,
      isUpdate: false,
      printsProcessed: cardData.prints.length,
      printsCreated: 0,
      printsUpdated: 0,
      skusGenerated: 0,
      imagesQueued: 0,
      imageProcessingStatus: ImageProcessingStatus.PENDING,
      retryCount: 0,
      processingTimeMs: 0,
      timestamp: new Date()
    }

    try {
      // Check card-level circuit breakers before processing
      if (this.isCardLevelCircuitBreakerOpen(game.code, CircuitBreakerType.DATABASE)) {
        result.success = false
        result.error = {
          type: 'database_error',
          message: 'Card processing skipped due to database circuit breaker',
          timestamp: new Date(),
          retryable: false
        }
        result.processingTimeMs = Date.now() - startTime
        logger.warn('Card processing skipped due to database circuit breaker', {
          cardName: cardData.name,
          gameCode: game.code
        })
        return result
      }

      // Generate hashes for deduplication
      cardData.oracleHash = generateOracleHash({
        name: cardData.name,
        type: cardData.primaryType,
        text: cardData.oracleText,
        gameSpecific: this.extractGameSpecificData(cardData)
      })
      result.oracleHash = cardData.oracleHash

      // Check if card already exists to determine if we'll skip or update
      const existingCard = await AppDataSource.getRepository(Card).findOne({
        where: { oracleHash: cardData.oracleHash }
      })

      if (existingCard && !this.config.forceUpdate) {
        // Skip duplicate card
        logger.cardSkipped(cardData.name, 'duplicate_oracle_hash', cardData.oracleHash, game.code, jobId)
        result.success = true // Mark as success but skipped
        result.processingTimeMs = Date.now() - startTime
        // Record success for circuit breaker
        this.recordCardLevelCircuitBreakerSuccess(game.code, CircuitBreakerType.DATABASE)
        return result
      }

      result.isUpdate = !!existingCard

      // Process this card in its own transaction
      const imageJobsToQueue: Array<{ printId: string, images: any, cardName: string }> = []
      
      await AppDataSource.transaction(async (manager) => {
        logger.cardProcessing(cardData.name, game.code, 'processing', jobId)

        // Upsert card
        const card = await this.upsertCard(cardData, game, manager)
        result.isUpdate = !card.isNew

        // Process prints
        
        for (const printData of cardData.prints) {
          printData.printHash = generatePrintHash({
            oracleHash: cardData.oracleHash!,
            setCode: printData.setCode,
            collectorNumber: printData.collectorNumber,
            artist: printData.artist
          })

          const print = await this.upsertPrint(printData, card.id, manager, game.code)
          if (print.isNew) {
            result.printsCreated++
          } else {
            result.printsUpdated++
          }

          // Generate SKUs
          const skus = await this.generateSKUsForPrint(print, manager, game.code, printData.setCode, printData.collectorNumber)
          result.skusGenerated += skus.length

          // Mark print as having images queued if images are available
          if (!this.config.skipImages && printData.images) {
            await manager.update(Print, { id: print.id }, {
              imageProcessingStatus: ImageProcessingStatus.QUEUED
            })

            imageJobsToQueue.push({
              printId: print.id,
              images: printData.images,
              cardName: cardData.name
            })
          }
        }
      })

      // Transaction completed successfully - now queue images OUTSIDE transaction
      if (imageJobsToQueue.length > 0) {
        try {
          for (const imageJob of imageJobsToQueue) {
            await this.queueImageProcessing(imageJob.printId, imageJob.images)
            result.imagesQueued++
          }
          result.imageProcessingStatus = ImageProcessingStatus.QUEUED
        } catch (error) {
          // If image queuing fails, update print status but don't rollback transaction
          logger.error('Failed to queue images after successful card transaction', error as Error, {
            cardName: cardData.name,
            gameCode: game.code,
            imageJobsCount: imageJobsToQueue.length
          })
          
          // Update print status to failed in a separate transaction
          try {
            await AppDataSource.transaction(async (errorManager) => {
              for (const imageJob of imageJobsToQueue) {
                await errorManager.update(Print, { id: imageJob.printId }, {
                  imageProcessingStatus: ImageProcessingStatus.FAILED,
                  imageProcessingError: (error as Error).message
                })
              }
            })
          } catch (updateError) {
            logger.error('Failed to update print status after image queue failure', updateError as Error)
          }

          result.imageProcessingStatus = ImageProcessingStatus.FAILED
          result.error = {
            type: 'image_error',
            message: `Failed to queue images: ${(error as Error).message}`,
            timestamp: new Date(),
            retryable: true
          }
          
          // Record image processing failure for circuit breaker
          this.recordCardLevelCircuitBreakerFailure(game.code, CircuitBreakerType.IMAGE_PROCESSING, error as Error)
        }
      }

      result.success = true
      result.processingTimeMs = Date.now() - startTime
      
      // Record success for circuit breakers
      this.recordCardLevelCircuitBreakerSuccess(game.code, CircuitBreakerType.DATABASE)
      if (result.imagesQueued > 0) {
        this.recordCardLevelCircuitBreakerSuccess(game.code, CircuitBreakerType.IMAGE_PROCESSING)
      }
      
      // Log successful import
      logger.cardImported(
        cardData.name,
        game.code,
        result.printsCreated,
        result.skusGenerated,
        result.isUpdate,
        jobId
      )

      return result
      
    } catch (error) {
      result.success = false
      result.processingTimeMs = Date.now() - startTime
      result.error = {
        type: 'database_error',
        message: (error as Error).message,
        timestamp: new Date(),
        retryable: true
      }
      
      // Record failure for circuit breakers
      this.recordCardLevelCircuitBreakerFailure(game.code, CircuitBreakerType.DATABASE, error as Error)
      
      logger.cardProcessing(cardData.name, game.code, 'failed', jobId)
      logger.error('Failed to process card atomically', error as Error, { 
        cardName: cardData.name,
        gameCode: game.code
      })

      return result
    }
  }

  /**
   * Retry a failed card with exponential backoff
   */
  private async retryCardImport(
    cardData: UniversalCard,
    game: Game,
    previousResult: CardImportResult,
    jobId?: string
  ): Promise<CardImportResult> {
    const maxRetries = this.config.maxRetries || 3
    const retryCount = previousResult.retryCount + 1
    
    if (retryCount > maxRetries) {
      logger.warn(`Card retry limit exceeded`, {
        cardName: cardData.name,
        retryCount,
        maxRetries,
        gameCode: game.code
      })
      return {
        ...previousResult,
        retryCount,
        processingTimeMs: 0,
        timestamp: new Date()
      }
    }

    // Exponential backoff delay
    const baseDelay = 1000 // 1 second
    const delay = baseDelay * Math.pow(2, retryCount - 1)
    
    logger.info(`Retrying card import with backoff`, {
      cardName: cardData.name,
      retryCount,
      delayMs: delay,
      gameCode: game.code
    })

    await this.sleep(delay)

    try {
      const retryResult = await this.processCardAtomically(cardData, game, jobId)
      retryResult.retryCount = retryCount
      
      if (retryResult.success) {
        logger.info(`Card retry successful`, {
          cardName: cardData.name,
          retryCount,
          gameCode: game.code
        })
      } else {
        logger.warn(`Card retry failed`, {
          cardName: cardData.name,
          retryCount,
          error: retryResult.error?.message,
          gameCode: game.code
        })
      }

      return retryResult
    } catch (error) {
      logger.error(`Card retry encountered unexpected error`, error as Error, {
        cardName: cardData.name,
        retryCount,
        gameCode: game.code
      })

      return {
        ...previousResult,
        retryCount,
        error: {
          type: 'database_error',
          message: `Retry ${retryCount} failed: ${(error as Error).message}`,
          timestamp: new Date(),
          retryable: retryCount < maxRetries
        },
        processingTimeMs: 0,
        timestamp: new Date()
      }
    }
  }

  /**
   * Process cards with retry logic for failed imports
   */
  private async processCardsWithRetry(
    cards: UniversalCard[],
    game: Game,
    jobId?: string
  ): Promise<CardImportResult[]> {
    const cardResults: CardImportResult[] = []
    const failedCards: Array<{ card: UniversalCard; result: CardImportResult }> = []

    // First pass: attempt all cards
    for (const cardData of cards) {
      try {
        const result = await this.processCardAtomically(cardData, game, jobId)
        cardResults.push(result)

        if (!result.success && result.error?.retryable) {
          failedCards.push({ card: cardData, result })
        }
      } catch (error) {
        const errorResult: CardImportResult = {
          cardName: cardData.name,
          oracleId: cardData.oracleId,
          oracleHash: cardData.oracleHash || '',
          success: false,
          isUpdate: false,
          printsProcessed: cardData.prints.length,
          printsCreated: 0,
          printsUpdated: 0,
          skusGenerated: 0,
          imagesQueued: 0,
          imageProcessingStatus: ImageProcessingStatus.PENDING,
          error: {
            type: 'database_error',
            message: (error as Error).message,
            timestamp: new Date(),
            retryable: true
          },
          retryCount: 0,
          processingTimeMs: 0,
          timestamp: new Date()
        }

        cardResults.push(errorResult)
        failedCards.push({ card: cardData, result: errorResult })
      }
    }

    // Retry failed cards
    if (failedCards.length > 0 && this.config.maxRetries > 0) {
      logger.info(`Starting retry phase for ${failedCards.length} failed cards`, {
        jobId,
        gameCode: game.code
      })

      for (const { card, result } of failedCards) {
        const retryResult = await this.retryCardImport(card, game, result, jobId)
        
        // Update the result in the main array
        const originalIndex = cardResults.findIndex(r => 
          r.cardName === card.name && r.oracleId === card.oracleId
        )
        if (originalIndex >= 0) {
          cardResults[originalIndex] = retryResult
        }
      }
    }

    return cardResults
  }

  /**
   * Process a batch of cards with individual card transactions
   */
  private async processBatch(cards: UniversalCard[], game: Game, jobId?: string): Promise<BatchImportResult> {
    const batchStartTime = Date.now()
    const createdSets = new Set<string>()

    // Process cards with retry logic
    const cardResults = await this.processCardsWithRetry(cards, game, jobId)

    // Track set creation and extract errors
    const errors: ETLError[] = []
    for (let i = 0; i < cards.length; i++) {
      const cardData = cards[i]
      const cardResult = cardResults[i]

      if (cardResult && cardResult.success) {
        for (const printData of cardData.prints) {
          createdSets.add(printData.setCode)
        }
      } else if (cardResult && cardResult.error) {
        errors.push(cardResult.error)
      }
    }

    // Calculate aggregated results
    const successfulCards = cardResults.filter(r => r.success).length
    const failedCards = cardResults.filter(r => !r.success).length
    const skippedCards = cardResults.filter(r => r.success && r.printsCreated === 0 && r.printsUpdated === 0).length

    const result: BatchImportResult = {
      totalCards: cards.length,
      successfulCards,
      failedCards,
      skippedCards,
      cardResults,
      batchProcessingTimeMs: Date.now() - batchStartTime,
      errors
    }

    return result
  }

  /**
   * Legacy batch processing method for compatibility
   */
  private async processBatchLegacy(cards: UniversalCard[], game: Game, jobId?: string): Promise<{
    cardsCreated: number
    cardsUpdated: number
    printsCreated: number
    printsUpdated: number
    skusGenerated: number
    imagesQueued: number
    cardsSkipped: number
    setsCreated: number
  }> {
    const batchResult = await this.processBatch(cards, game, jobId)
    
    // Convert BatchImportResult to legacy format
    return {
      cardsCreated: batchResult.cardResults.filter(r => r.success && !r.isUpdate).length,
      cardsUpdated: batchResult.cardResults.filter(r => r.success && r.isUpdate).length,
      printsCreated: batchResult.cardResults.reduce((sum, r) => sum + r.printsCreated, 0),
      printsUpdated: batchResult.cardResults.reduce((sum, r) => sum + r.printsUpdated, 0),
      skusGenerated: batchResult.cardResults.reduce((sum, r) => sum + r.skusGenerated, 0),
      imagesQueued: batchResult.cardResults.reduce((sum, r) => sum + r.imagesQueued, 0),
      cardsSkipped: batchResult.skippedCards,
      setsCreated: 0 // Will be calculated if needed
    }
  }

  /**
   * Upsert card (assumes duplicate check already done in processBatch)
   */
  private async upsertCard(cardData: UniversalCard, game: Game, manager: any): Promise<{
    id: string
    isNew: boolean
  }> {
    // Check if card already exists by oracle hash (for updates)
    let existingCard = await manager.findOne(Card, {
      where: { oracleHash: cardData.oracleHash }
    })

    if (existingCard) {
      // Update existing card (only when force update is enabled)
      await manager.update(Card, { id: existingCard.id }, {
        name: cardData.name,
        normalizedName: cardData.normalizedName,
        primaryType: cardData.primaryType,
        subtypes: cardData.subtypes,
        oracleText: cardData.oracleText,
        flavorText: cardData.flavorText,
        keywords: cardData.keywords,
        // Game-specific fields
        manaCost: cardData.manaCost,
        manaValue: cardData.manaValue,
        colors: cardData.colors,
        hp: cardData.hp,
        attribute: cardData.attribute,
        // Extended attributes
        extendedAttributes: cardData.extendedAttributes || {},
        updatedAt: new Date()
      })
      
      return { id: existingCard.id, isNew: false }
    }

    // Create new card
    const newCard = manager.create(Card, {
      gameId: game.id,
      oracleId: cardData.oracleId,
      oracleHash: cardData.oracleHash,
      name: cardData.name,
      normalizedName: cardData.normalizedName,
      primaryType: cardData.primaryType,
      subtypes: cardData.subtypes || [],
      supertypes: cardData.supertypes || [],
      powerValue: cardData.powerValue,
      defenseValue: cardData.defenseValue,
      oracleText: cardData.oracleText,
      flavorText: cardData.flavorText,
      keywords: cardData.keywords || [],
      // MTG specific
      manaCost: cardData.manaCost,
      manaValue: cardData.manaValue,
      colors: cardData.colors || [],
      colorIdentity: cardData.colorIdentity || [],
      // Pokemon specific
      hp: cardData.hp,
      retreatCost: cardData.retreatCost,
      energyTypes: cardData.energyTypes || [],
      evolutionStage: cardData.evolutionStage,
      // YuGiOh specific
      attribute: cardData.attribute,
      levelRank: cardData.levelRank,
      attackValue: cardData.attackValue,
      defenseValueYugioh: cardData.defenseValueYugioh,
      // One Piece specific
      cost: cardData.cost,
      donCost: cardData.donCost,
      lifeValue: cardData.lifeValue,
      counterValue: cardData.counterValue,
      power: cardData.power,
      // Extended attributes
      extendedAttributes: cardData.extendedAttributes || {},
      popularityScore: 0,
      totalViews: 0,
      totalSearches: 0
    })

    const savedCard = await manager.save(Card, newCard)
    return { id: savedCard.id, isNew: true }
  }

  /**
   * Upsert print with duplicate detection
   */
  private async upsertPrint(printData: any, cardId: string, manager: any, gameCode: string): Promise<{
    id: string
    isNew: boolean
  }> {
    // Check if print already exists by print hash
    let existingPrint = await manager.findOne(Print, {
      where: { printHash: printData.printHash }
    })

    if (existingPrint) {
      return { id: existingPrint.id, isNew: false }
    }

    // Get or create set
    const set = await this.getOrCreateSet(printData.setCode, printData.setName, cardId, manager)

    // Create new print
    const newPrint = manager.create(Print, {
      cardId,
      setId: set.id,
      printHash: printData.printHash,
      collectorNumber: printData.collectorNumber,
      rarity: printData.rarity,
      artist: printData.artist,
      flavorText: printData.flavorText,
      language: printData.language || 'en',
      isFoilAvailable: printData.isFoilAvailable || false,
      isAlternateArt: printData.isAlternateArt || false,
      isPromo: printData.isPromo || false,
      finish: printData.finish || 'normal',
      variation: printData.variation,
      frame: printData.frame,
      borderColor: printData.borderColor,
      // Format legality (from transformer data)
      ...this.extractFormatLegalityFields(printData.formatLegality, gameCode),
      // External IDs
      scryfallId: printData.externalIds?.scryfall,
      tcgplayerId: printData.externalIds?.tcgplayer,
      pokemonTcgId: printData.externalIds?.pokemonTcg,
      yugiohProdeckId: printData.externalIds?.yugiohProdeck,
      // Images
      imageSmall: printData.images?.small,
      imageNormal: printData.images?.normal,
      imageLarge: printData.images?.large,
      imageArtCrop: printData.images?.artCrop,
      // Pricing
      currentLowPrice: printData.prices?.usd,
      currentMarketPrice: printData.prices?.usd
    })

    const savedPrint = await manager.save(Print, newPrint)
    return { id: savedPrint.id, isNew: true }
  }

  /**
   * Generate SKUs for all condition/language combinations
   */
  private async generateSKUsForPrint(print: any, manager: any, gameCode: string, setCode: string, collectorNumber: string): Promise<CatalogSKU[]> {
    const conditions = ['NM', 'LP', 'MP', 'HP', 'DMG']
    const languages = ['EN'] // Start with English, expand later
    const finishes = print.isFoilAvailable ? ['NORMAL', 'FOIL'] : ['NORMAL']
    
    const skus: CatalogSKU[] = []
    
    for (const condition of conditions) {
      for (const language of languages) {
        for (const finish of finishes) {
          const sku = formatSKU({
            gameCode: gameCode,
            setCode: setCode,
            collectorNumber: collectorNumber,
            languageCode: language,
            conditionCode: condition,
            finishCode: finish
          })

          const catalogSku = manager.create(CatalogSKU, {
            printId: print.id,
            sku,
            gameCode: gameCode,
            setCode: setCode,
            collectorNumber: collectorNumber,
            languageCode: language,
            conditionCode: condition,
            finishCode: finish,
            hasB2cInventory: false,
            hasC2cListings: false,
            vendorCount: 0,
            isActive: true
          })

          const savedSku = await manager.save(CatalogSKU, catalogSku)
          skus.push(savedSku)
        }
      }
    }

    return skus
  }

  /**
   * Get or create card set
   */
  private async getOrCreateSet(setCode: string, setName: string, cardId: string, manager: any): Promise<CardSet> {
    // Get game from card
    const card = await manager.findOne(Card, { 
      where: { id: cardId },
      relations: ['game']
    })

    if (!card) {
      throw new Error(`Card not found: ${cardId}`)
    }

    // Check if set exists
    let existingSet = await manager.findOne(CardSet, {
      where: { gameId: card.gameId, code: setCode }
    })

    if (existingSet) {
      return existingSet
    }

    // Create new set
    const newSet = manager.create(CardSet, {
      gameId: card.gameId,
      code: setCode,
      name: setName,
      setType: 'expansion', // Default, can be enhanced later
      cardCount: 0,
      isDigitalOnly: false,
      isFoilOnly: false,
      hasAlternateArts: false,
      isStandardLegal: true
    })

    return await manager.save(CardSet, newSet)
  }

  /**
   * Card-Level Circuit Breaker Implementation
   */
  private getCardLevelCircuitBreakerKey(gameCode: string, type: CircuitBreakerType): string {
    return `${gameCode}:${type}`
  }

  private getCardLevelCircuitBreakerConfig(type: CircuitBreakerType): CircuitBreakerConfig {
    const configs: Record<CircuitBreakerType, CircuitBreakerConfig> = {
      [CircuitBreakerType.GAME_LEVEL]: {
        threshold: this.config.circuitBreakerThreshold,
        resetTimeout: this.config.circuitBreakerResetTimeout,
        maxHalfOpenAttempts: 3,
        enabled: true
      },
      [CircuitBreakerType.DATABASE]: {
        threshold: 5,
        resetTimeout: 30000, // 30 seconds
        maxHalfOpenAttempts: 2,
        enabled: true
      },
      [CircuitBreakerType.API_RATE_LIMIT]: {
        threshold: 3,
        resetTimeout: 60000, // 1 minute
        maxHalfOpenAttempts: 1,
        enabled: true
      },
      [CircuitBreakerType.VALIDATION]: {
        threshold: 10,
        resetTimeout: 15000, // 15 seconds
        maxHalfOpenAttempts: 2,
        enabled: true
      },
      [CircuitBreakerType.IMAGE_PROCESSING]: {
        threshold: 8,
        resetTimeout: 45000, // 45 seconds
        maxHalfOpenAttempts: 3,
        enabled: true
      },
      [CircuitBreakerType.EXTERNAL_SERVICE]: {
        threshold: 5,
        resetTimeout: 60000, // 1 minute
        maxHalfOpenAttempts: 2,
        enabled: true
      }
    }
    return configs[type]
  }

  private isCardLevelCircuitBreakerOpen(gameCode: string, type: CircuitBreakerType): boolean {
    const key = this.getCardLevelCircuitBreakerKey(gameCode, type)
    const state = this.cardLevelCircuitBreakers.get(key)
    
    if (!state) return false

    const config = this.getCardLevelCircuitBreakerConfig(type)
    if (!config.enabled) return false

    if (state.isOpen) {
      const now = Date.now()
      const timeSinceLastFailure = now - (state.lastFailureTime?.getTime() || 0)
      
      if (timeSinceLastFailure > state.resetTimeout) {
        // Move to half-open state
        state.isOpen = false
        state.halfOpenAttempts = 0
        logger.info(`Circuit breaker moving to half-open`, {
          gameCode,
          type,
          timeSinceLastFailure
        })
        return false
      }
      
      return true
    }

    return false
  }

  private recordCardLevelCircuitBreakerSuccess(gameCode: string, type: CircuitBreakerType): void {
    const key = this.getCardLevelCircuitBreakerKey(gameCode, type)
    let state = this.cardLevelCircuitBreakers.get(key)
    
    if (!state) {
      const config = this.getCardLevelCircuitBreakerConfig(type)
      state = {
        type,
        gameCode,
        isOpen: false,
        failureCount: 0,
        successCount: 0,
        consecutiveFailures: 0,
        resetTimeout: config.resetTimeout,
        threshold: config.threshold,
        halfOpenAttempts: 0,
        maxHalfOpenAttempts: config.maxHalfOpenAttempts
      }
      this.cardLevelCircuitBreakers.set(key, state)
    }

    state.successCount++
    state.lastSuccessTime = new Date()
    state.consecutiveFailures = 0

    // If we were in half-open state and got successful attempts, close the circuit
    if (state.halfOpenAttempts > 0) {
      state.halfOpenAttempts = 0
      logger.info(`Circuit breaker closed after successful half-open attempts`, {
        gameCode,
        type,
        successCount: state.successCount
      })
    }
  }

  private recordCardLevelCircuitBreakerFailure(gameCode: string, type: CircuitBreakerType, error: Error): void {
    const key = this.getCardLevelCircuitBreakerKey(gameCode, type)
    let state = this.cardLevelCircuitBreakers.get(key)
    const config = this.getCardLevelCircuitBreakerConfig(type)
    
    if (!config.enabled) return

    if (!state) {
      state = {
        type,
        gameCode,
        isOpen: false,
        failureCount: 0,
        successCount: 0,
        consecutiveFailures: 0,
        resetTimeout: config.resetTimeout,
        threshold: config.threshold,
        halfOpenAttempts: 0,
        maxHalfOpenAttempts: config.maxHalfOpenAttempts
      }
      this.cardLevelCircuitBreakers.set(key, state)
    }

    state.failureCount++
    state.consecutiveFailures++
    state.lastFailureTime = new Date()

    // If we were in half-open state and failed, reopen the circuit
    if (state.halfOpenAttempts > 0) {
      state.isOpen = true
      state.halfOpenAttempts = 0
      logger.warn(`Circuit breaker reopened after half-open failure`, {
        gameCode,
        type,
        error: error.message,
        consecutiveFailures: state.consecutiveFailures
      })
      return
    }

    // Check if we should open the circuit
    if (state.consecutiveFailures >= state.threshold) {
      state.isOpen = true
      logger.error(`Circuit breaker opened due to consecutive failures`, error, {
        gameCode,
        type,
        consecutiveFailures: state.consecutiveFailures,
        threshold: state.threshold
      })
    }
  }

  private shouldSkipCardDueToCircuitBreaker(gameCode: string, error?: ETLError): boolean {
    if (!error) return false

    // Map error types to circuit breaker types
    const typeMapping: Record<string, CircuitBreakerType> = {
      'database_error': CircuitBreakerType.DATABASE,
      'api_error': CircuitBreakerType.API_RATE_LIMIT,
      'validation_error': CircuitBreakerType.VALIDATION,
      'image_error': CircuitBreakerType.IMAGE_PROCESSING
    }

    const circuitBreakerType = typeMapping[error.type] || CircuitBreakerType.EXTERNAL_SERVICE
    return this.isCardLevelCircuitBreakerOpen(gameCode, circuitBreakerType)
  }

  /**
   * Circuit Breaker Implementation (Legacy)
   */
  private isCircuitBreakerOpen(gameCode: string): boolean {
    const state = this.circuitBreakers.get(gameCode)
    if (!state) return false

    if (state.isOpen) {
      const now = Date.now()
      const timeSinceLastFailure = now - (state.lastFailureTime?.getTime() || 0)
      
      if (timeSinceLastFailure > this.config.circuitBreakerResetTimeout) {
        // Reset circuit breaker
        state.isOpen = false
        state.failureCount = 0
        logger.circuitBreakerClosed(gameCode)
        return false
      }
      
      return true
    }

    return false
  }

  private recordFailure(gameCode: string): void {
    let state = this.circuitBreakers.get(gameCode)
    if (!state) {
      state = {
        isOpen: false,
        failureCount: 0,
        resetTimeout: this.config.circuitBreakerResetTimeout
      }
      this.circuitBreakers.set(gameCode, state)
    }

    state.failureCount++
    state.lastFailureTime = new Date()

    if (state.failureCount >= this.config.circuitBreakerThreshold) {
      state.isOpen = true
      logger.circuitBreakerOpened(gameCode, state.failureCount)
    }
  }

  /**
   * ETL Job Management
   */
  private async createETLJob(gameCode: string, jobType: ETLJobType, triggeredBy: string): Promise<string> {
    const job = AppDataSource.getRepository(ETLJob).create({
      jobName: `${gameCode}_${jobType}_${Date.now()}`,
      jobType,
      gameCode,
      status: ETLJobStatus.PENDING,
      triggeredBy,
      config: this.config,
      totalRecords: 0,
      processedRecords: 0,
      successfulRecords: 0,
      failedRecords: 0,
      skippedRecords: 0,
      progressPercent: 0
    })

    const savedJob = await AppDataSource.getRepository(ETLJob).save(job)
    return savedJob.id
  }

  private async updateETLJobProgress(jobId: string, processed: number, total: number): Promise<void> {
    const progress = total > 0 ? Math.round((processed / total) * 100) : 0
    
    await AppDataSource.getRepository(ETLJob).update(jobId, {
      processedRecords: processed,
      totalRecords: total,
      progressPercent: progress,
      updatedAt: new Date()
    })
  }

  private async completeETLJob(jobId: string, result: ETLResult): Promise<void> {
    await AppDataSource.getRepository(ETLJob).update(jobId, {
      status: ETLJobStatus.COMPLETED,
      completedAt: new Date(),
      durationMs: result.duration,
      cardsCreated: result.cardsCreated,
      cardsUpdated: result.cardsUpdated,
      printsCreated: result.printsCreated,
      printsUpdated: result.printsUpdated,
      skusGenerated: result.skusGenerated,
      successfulRecords: result.totalProcessed - result.errors.length,
      failedRecords: result.errors.length
    })
  }

  private async failETLJob(jobId: string, error: Error): Promise<void> {
    await AppDataSource.getRepository(ETLJob).update(jobId, {
      status: ETLJobStatus.FAILED,
      completedAt: new Date(),
      errorMessage: error.message
    })
  }

  /**
   * Helper methods
   */
  private async getGame(gameCode: string): Promise<Game | null> {
    return await AppDataSource.getRepository(Game).findOne({
      where: { code: gameCode }
    })
  }

  private getDataTransformer(provider: string): ScryfallTransformer | PokemonTransformer | YugiohTransformer | OnePieceTransformer {
    switch (provider) {
      case 'scryfall':
        return new ScryfallTransformer()
      case 'pokemon_tcg':
        return new PokemonTransformer()
      case 'ygoprodeck':
        return new YugiohTransformer()
      case 'onepiece_tcg':
        return new OnePieceTransformer()
      default:
        throw new Error(`Unknown data provider: ${provider}`)
    }
  }

  private extractGameSpecificData(card: UniversalCard): any {
    return {
      manaCost: card.manaCost,
      colors: card.colors,
      hp: card.hp,
      attribute: card.attribute,
      cost: card.cost
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Extract format legality fields from transformer data
   */
  private extractFormatLegalityFields(formatLegality?: Record<string, string>, gameCode?: string): any {
    const legalityFields: any = {
      // MTG formats
      isLegalStandard: false,
      isLegalPioneer: false,
      isLegalModern: false,
      isLegalLegacy: false,
      isLegalVintage: false,
      isLegalCommander: false,
      isLegalPauper: false,
      isLegalBrawl: false,
      
      // Pokemon formats
      isLegalPokemonStandard: false,
      isLegalPokemonExpanded: false,
      isLegalPokemonUnlimited: false,
      
      // Yu-Gi-Oh! formats
      isLegalYugiohAdvanced: false,
      isLegalYugiohTraditional: false,
      
      // One Piece formats
      isLegalOnePieceStandard: false
    }

    if (!formatLegality) {
      return legalityFields
    }

    // Game-specific format mapping
    switch (gameCode) {
      case 'MTG':
        // MTG format mapping (from Scryfall API)
        if (formatLegality.standard === 'legal') {
          legalityFields.isLegalStandard = true
        }
        if (formatLegality.pioneer === 'legal') {
          legalityFields.isLegalPioneer = true
        }
        if (formatLegality.modern === 'legal') {
          legalityFields.isLegalModern = true
        }
        if (formatLegality.legacy === 'legal') {
          legalityFields.isLegalLegacy = true
        }
        if (formatLegality.vintage === 'legal') {
          legalityFields.isLegalVintage = true
        }
        if (formatLegality.commander === 'legal') {
          legalityFields.isLegalCommander = true
        }
        if (formatLegality.pauper === 'legal') {
          legalityFields.isLegalPauper = true
        }
        if (formatLegality.brawl === 'legal') {
          legalityFields.isLegalBrawl = true
        }
        break

      case 'POKEMON':
        // Pokemon format mapping (from Pokemon TCG API)
        if (formatLegality.standard === 'legal') {
          legalityFields.isLegalPokemonStandard = true
        }
        if (formatLegality.expanded === 'legal') {
          legalityFields.isLegalPokemonExpanded = true
        }
        if (formatLegality.unlimited === 'legal') {
          legalityFields.isLegalPokemonUnlimited = true
        }
        break

      case 'YUGIOH':
        // Yu-Gi-Oh! format mapping (general - both advanced and traditional are same for most cards)
        if (formatLegality.tcg === 'legal' || formatLegality.advanced === 'legal') {
          legalityFields.isLegalYugiohAdvanced = true
          legalityFields.isLegalYugiohTraditional = true // Traditional allows more cards, so if advanced is legal, traditional is too
        }
        if (formatLegality.traditional === 'legal') {
          legalityFields.isLegalYugiohTraditional = true
        }
        break

      case 'OPTCG':
        // One Piece format mapping (currently all cards are legal in standard)
        if (formatLegality.standard === 'legal' || formatLegality.onepiece === 'legal') {
          legalityFields.isLegalOnePieceStandard = true
        }
        // For now, assume all One Piece cards are legal in standard format
        legalityFields.isLegalOnePieceStandard = true
        break

      default:
        // If game code is unknown, don't set any legality
        break
    }

    return legalityFields
  }

  /**
   * Queue image processing for a print with smart deduplication
   */
  private async queueImageProcessing(printId: string, images: any): Promise<void> {
    try {
      // Get the image processing queue
      const imageQueue = getImageQueue()
      
      // Prepare image URLs for processing with deduplication
      const imageUrls: Record<string, string> = {}
      const uniqueUrls = new Set<string>()
      const urlMapping: Record<string, string[]> = {} // Maps unique URL to image types
      
      // Collect all potential image URLs
      // IMPORTANT: Order matters for deduplication - prioritize HIGHEST QUALITY sources first
      const potentialImages = {
        png: images.png,            // PNG format - highest quality (priority 1)
        large: images.large,        // Full card image (priority 2) 
        normal: images.normal,      // Full card image (priority 3)
        small: images.small,        // Full card image (priority 4)
        artCrop: images.artCrop,    // Artwork only (lower priority)
        borderCrop: images.borderCrop,
        back: images.back
      }
      
      // Option B: Single highest-quality job per print
      // Process only the FIRST (highest priority) image URL found to eliminate race conditions
      let selectedImageType: string | null = null
      let selectedImageUrl: string | null = null
      
      for (const [imageType, url] of Object.entries(potentialImages)) {
        if (!url) continue
        
        // Use the first (highest priority) image found
        selectedImageType = imageType
        selectedImageUrl = url
        break
      }
      
      if (selectedImageType && selectedImageUrl) {
        // Create comprehensive mapping - this single job will handle ALL image types
        const normalizedUrl = this.normalizeImageUrl(selectedImageUrl)
        imageUrls[selectedImageType] = selectedImageUrl
        
        // Map this single high-quality source to ALL image types for database updates
        urlMapping[normalizedUrl] = Object.keys(potentialImages).filter(type => potentialImages[type as keyof typeof potentialImages])
        
        logger.info('High-quality image selected for processing', {
          printId,
          selectedType: selectedImageType,
          selectedUrl: selectedImageUrl.substring(selectedImageUrl.lastIndexOf('/') + 1, selectedImageUrl.lastIndexOf('/') + 20) + '...',
          willRepresent: urlMapping[normalizedUrl],
          qualityOptimization: 'Using single highest-quality source to eliminate race conditions'
        })
      }
      
      // Skip if no unique images to process
      if (Object.keys(imageUrls).length === 0) {
        logger.debug('No unique images to process for print', { printId })
        return
      }
      
      // Log quality optimization results
      const availableCount = Object.values(potentialImages).filter(url => url).length
      const selectedCount = Object.keys(imageUrls).length
      
      if (availableCount > 1) {
        logger.info('Quality optimization applied', {
          printId,
          availableImageCount: availableCount,
          selectedForProcessing: selectedCount,
          optimizationStrategy: 'Single highest-quality source',
          eliminatedRaceConditions: availableCount - selectedCount,
          urlMappings: Object.fromEntries(
            Object.entries(urlMapping).map(([url, types]) => [
              url.substring(url.lastIndexOf('/') + 1, url.lastIndexOf('/') + 20) + '...', 
              types
            ])
          )
        })
      }
      
      // Add job to queue with proper priority and mapping info
      const job = await imageQueue.add('process-images', {
        printId,
        imageUrls, // Only unique URLs
        urlMapping, // Mapping of URLs to all image types they represent
        priority: 5 // Normal priority
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: 50,
        removeOnFail: 25
      })
      
      logger.debug('Optimized image processing job queued', {
        printId,
        jobId: String(job.id),
        uniqueImageCount: Object.keys(imageUrls).length,
        totalImageTypes: availableCount
      })
      
    } catch (error) {
      logger.error('Failed to queue image processing', error as Error, { printId })
      // Don't throw - image processing failure shouldn't stop ETL
    }
  }

  /**
   * Normalize image URL for comparison (remove query params, fragments)
   */
  private normalizeImageUrl(url: string): string {
    try {
      const urlObj = new URL(url)
      // Keep only protocol, host, port, and pathname
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`
    } catch (error) {
      // If URL parsing fails, return original URL
      logger.warn('Failed to normalize image URL', { url })
      return url
    }
  }

  /**
   * Sync MTG cards from Scryfall
   */
  async syncMTGCards(): Promise<ETLResult> {
    return this.startETLJob('MTG', ETLJobType.FULL_SYNC, 'automated')
  }

  /**
   * Sync Pokemon cards from Pokemon TCG API
   */
  async syncPokemonCards(): Promise<ETLResult> {
    return this.startETLJob('POKEMON', ETLJobType.FULL_SYNC, 'automated')
  }

  /**
   * Sync Yu-Gi-Oh cards from YGOPRODeck API
   */
  async syncYuGiOhCards(): Promise<ETLResult> {
    return this.startETLJob('YUGIOH', ETLJobType.FULL_SYNC, 'automated')
  }

  /**
   * Sync One Piece cards from OP TCG API
   */
  async syncOnePieceCards(): Promise<ETLResult> {
    return this.startETLJob('ONEPIECE', ETLJobType.FULL_SYNC, 'automated')
  }

  /**
   * Sync images for all games
   */
  async syncAllImages(): Promise<ETLResult[]> {
    const results: ETLResult[] = []
    const games = ['MTG', 'POKEMON', 'YUGIOH', 'ONEPIECE']
    
    for (const gameCode of games) {
      try {
        const result = await this.startETLJob(gameCode, ETLJobType.IMAGE_SYNC, 'automated')
        results.push(result)
      } catch (error) {
        logger.error(`Failed to sync images for ${gameCode}`, error as Error)
        results.push({
          success: false,
          gameCode,
          totalProcessed: 0,
          cardsCreated: 0,
          cardsUpdated: 0,
          cardsDeleted: 0,
          printsCreated: 0,
          printsUpdated: 0,
          imagesQueued: 0,
          skusGenerated: 0,
          duration: 0,
          errors: [{
            type: 'image_error',
            message: (error as Error).message,
            timestamp: new Date(),
            retryable: true
          }],
          cardsSkipped: 0,
          cardsRetried: 0,
          imageProcessingCompleted: 0,
          imageProcessingFailed: 0
        })
      }
    }
    
    return results
  }

  /**
   * Sync images for MTG cards
   */
  async syncMTGImages(): Promise<ETLResult> {
    return this.startETLJob('MTG', ETLJobType.IMAGE_SYNC, 'automated')
  }

  /**
   * Sync images for Pokemon cards
   */
  async syncPokemonImages(): Promise<ETLResult> {
    return this.startETLJob('POKEMON', ETLJobType.IMAGE_SYNC, 'automated')
  }

  /**
   * Sync images for Yu-Gi-Oh cards
   */
  async syncYuGiOhImages(): Promise<ETLResult> {
    return this.startETLJob('YUGIOH', ETLJobType.IMAGE_SYNC, 'automated')
  }

  /**
   * Sync images for One Piece cards
   */
  async syncOnePieceImages(): Promise<ETLResult> {
    return this.startETLJob('ONEPIECE', ETLJobType.IMAGE_SYNC, 'automated')
  }
}


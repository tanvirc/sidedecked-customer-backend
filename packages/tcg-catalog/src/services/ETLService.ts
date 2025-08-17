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
  ImportCheckpoint
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
// import { getImageQueue } from '../../../../src/config/infrastructure' // Disabled for now

export class ETLService {
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()
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
      errors: []
    }

    // Track statistics for comprehensive summary
    let cardsSkipped = 0
    let setsCreated = 0

    try {
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
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        
        try {
          const batchResult = await this.processBatch(batch, game, jobId)
          
          // Aggregate results
          result.cardsCreated += batchResult.cardsCreated
          result.cardsUpdated += batchResult.cardsUpdated
          result.printsCreated += batchResult.printsCreated
          result.printsUpdated += batchResult.printsUpdated
          result.skusGenerated += batchResult.skusGenerated
          result.imagesQueued += batchResult.imagesQueued
          cardsSkipped += batchResult.cardsSkipped || 0
          setsCreated += batchResult.setsCreated || 0
          
          // Update progress
          const processed = (i + 1) * this.config.batchSize
          await this.updateETLJobProgress(jobId, processed, cards.length)
          
          logger.etlProgress(jobId, processed, cards.length)
          
          // Rate limiting
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
   * Process a batch of cards with transaction handling
   */
  private async processBatch(cards: UniversalCard[], game: Game, jobId?: string): Promise<{
    cardsCreated: number
    cardsUpdated: number
    printsCreated: number
    printsUpdated: number
    skusGenerated: number
    imagesQueued: number
    cardsSkipped: number
    setsCreated: number
  }> {
    const result = {
      cardsCreated: 0,
      cardsUpdated: 0,
      printsCreated: 0,
      printsUpdated: 0,
      skusGenerated: 0,
      imagesQueued: 0,
      cardsSkipped: 0,
      setsCreated: 0
    }

    const createdSets = new Set<string>() // Track unique sets created

    return await AppDataSource.transaction(async (manager) => {
      for (const cardData of cards) {
        try {
          // Log that we're processing this card
          logger.cardProcessing(cardData.name, game.code, 'processing', jobId)
          
          // Generate hashes for deduplication
          cardData.oracleHash = generateOracleHash({
            name: cardData.name,
            type: cardData.primaryType,
            text: cardData.oracleText,
            gameSpecific: this.extractGameSpecificData(cardData)
          })

          // Check if card already exists to determine if we'll skip or update
          const existingCard = await manager.findOne(Card, {
            where: { oracleHash: cardData.oracleHash }
          })

          if (existingCard && !this.config.forceUpdate) {
            // Skip duplicate card
            logger.cardSkipped(cardData.name, 'duplicate_oracle_hash', cardData.oracleHash, game.code, jobId)
            result.cardsSkipped++
            continue
          }

          // Upsert card
          const card = await this.upsertCard(cardData, game, manager)
          if (card.isNew) {
            result.cardsCreated++
          } else {
            result.cardsUpdated++
          }

          // Process prints
          let cardPrintsCreated = 0
          let cardSkusCreated = 0
          
          for (const printData of cardData.prints) {
            printData.printHash = generatePrintHash({
              oracleHash: cardData.oracleHash,
              setCode: printData.setCode,
              collectorNumber: printData.collectorNumber,
              artist: printData.artist
            })

            const print = await this.upsertPrint(printData, card.id, manager)
            if (print.isNew) {
              result.printsCreated++
              cardPrintsCreated++
              
              // Track set creation
              createdSets.add(printData.setCode)
            } else {
              result.printsUpdated++
            }

            // Generate SKUs
            const skus = await this.generateSKUsForPrint(print, manager, game.code, printData.setCode, printData.collectorNumber)
            result.skusGenerated += skus.length
            cardSkusCreated += skus.length

            // Queue image processing if not skipping images
            if (!this.config.skipImages && printData.images) {
              await this.queueImageProcessing(print.id, printData.images)
              result.imagesQueued++
            }
          }

          // Log successful card import
          logger.cardImported(
            cardData.name, 
            game.code, 
            cardPrintsCreated, 
            cardSkusCreated, 
            !card.isNew, 
            jobId
          )
          
        } catch (error) {
          // Log failed card processing
          logger.cardProcessing(cardData.name, game.code, 'failed', jobId)
          logger.error('Failed to process card', error as Error, { 
            cardName: cardData.name,
            gameCode: game.code
          })
          throw error
        }
      }

      // Set final counts
      result.setsCreated = createdSets.size

      return result
    })
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
  private async upsertPrint(printData: any, cardId: string, manager: any): Promise<{
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
      ...this.extractFormatLegalityFields(printData.formatLegality),
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
   * Circuit Breaker Implementation
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
  private extractFormatLegalityFields(formatLegality?: Record<string, string>): any {
    const legalityFields: any = {
      isLegalStandard: false,
      isLegalPioneer: false,
      isLegalModern: false,
      isLegalLegacy: false,
      isLegalVintage: false,
      isLegalCommander: false
    }

    if (!formatLegality) {
      return legalityFields
    }

    // Map transformer format codes to entity fields
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

    // Handle Pokemon-specific formats
    if (formatLegality.expanded === 'legal') {
      legalityFields.isLegalModern = true // Map expanded to modern for Pokemon
    }
    if (formatLegality.unlimited === 'legal') {
      legalityFields.isLegalLegacy = true // Map unlimited to legacy for Pokemon
    }

    // Handle YuGiOh-specific formats
    if (formatLegality.tcg === 'legal') {
      legalityFields.isLegalStandard = true // Map TCG to standard for YuGiOh
    }
    if (formatLegality.ocg === 'legal') {
      legalityFields.isLegalModern = true // Map OCG to modern for YuGiOh
    }

    return legalityFields
  }

  /**
   * Queue image processing for a print
   */
  private async queueImageProcessing(printId: string, images: any): Promise<void> {
    // Image processing disabled for standalone ETL
    logger.debug('Image processing skipped (not available in standalone mode)', { printId })
    return
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
}


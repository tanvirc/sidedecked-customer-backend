#!/usr/bin/env ts-node
/**
 * Master ETL Script for SideDecked TCG Catalog
 * 
 * This is the unified ETL script that uses the robust packages/tcg-catalog infrastructure
 * to import card data and banlist information for all supported TCG games.
 * 
 * Usage:
 *   npm run etl -- --game=MTG,POKEMON --limit=100
 *   npm run etl -- --all --limit=500
 *   npm run etl -- --game=MTG --type=full
 */

// Disable TypeORM query logging for cleaner ETL output
process.env.DISABLE_TYPEORM_LOGGING = 'true'

import { program } from 'commander'
import { DataSource } from 'typeorm'
import { AppDataSource } from '../config/database'
import { ETLService } from '../../packages/tcg-catalog/src/services/ETLService'
import { ETLJobType } from '../../packages/tcg-catalog/src/entities/ETLJob'
import { Game } from '../entities/Game'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'

interface ETLOptions {
  game?: string[]
  all?: boolean
  limit?: number
  type?: ETLJobType
  skipImages?: boolean
  forceUpdate?: boolean
}

async function initializeDatabase(): Promise<void> {
  try {
    await AppDataSource.initialize()
    logger.info('🗄️  Database connection established')
  } catch (error) {
    logger.error('Failed to initialize database', error as Error)
    throw error
  }
}

async function getAvailableGames(): Promise<Game[]> {
  const gameRepository = AppDataSource.getRepository(Game)
  return await gameRepository.find({ where: { etlEnabled: true } })
}

async function ensureGamesExist(): Promise<void> {
  const gameRepository = AppDataSource.getRepository(Game)
  
  const defaultGames = [
    {
      code: 'MTG',
      name: 'Magic: The Gathering',
      displayName: 'Magic: The Gathering',
      apiProvider: 'scryfall',
      etlEnabled: true
    },
    {
      code: 'POKEMON',
      name: 'Pokémon',
      displayName: 'Pokémon Trading Card Game',
      apiProvider: 'pokemon_tcg',
      etlEnabled: true
    },
    {
      code: 'YUGIOH',
      name: 'Yu-Gi-Oh!',
      displayName: 'Yu-Gi-Oh! Trading Card Game',
      apiProvider: 'ygoprodeck',
      etlEnabled: true
    },
    {
      code: 'OPTCG',
      name: 'One Piece',
      displayName: 'One Piece Card Game',
      apiProvider: 'onepiece_tcg',
      etlEnabled: true
    }
  ]

  for (const gameData of defaultGames) {
    const existingGame = await gameRepository.findOne({
      where: { code: gameData.code }
    })

    if (!existingGame) {
      const game = gameRepository.create(gameData)
      await gameRepository.save(game)
      logger.info(`Created game: ${gameData.name} (${gameData.code})`)
    }
  }
}

async function runETLForGame(gameCode: string, options: ETLOptions): Promise<void> {
  const etlService = new ETLService({
    batchSize: Math.min(options.limit || 100, 250),
    skipImages: options.skipImages || false,
    forceUpdate: options.forceUpdate || false,
    rateLimitDelay: gameCode === 'POKEMON' ? 1000 : 500, // Pokemon SDK is more sensitive
    concurrency: 1 // Keep it simple for reliability
  })

  // Convert string type to enum
  let jobType = ETLJobType.INCREMENTAL_SYNC
  if (options.type) {
    switch (options.type) {
      case 'full_sync':
        jobType = ETLJobType.FULL_SYNC
        break
      case 'incremental_sync':
        jobType = ETLJobType.INCREMENTAL_SYNC
        break
      case 'banlist_update':
        jobType = ETLJobType.BANLIST_UPDATE
        break
      default:
        jobType = ETLJobType.INCREMENTAL_SYNC
    }
  } else if (options.limit && options.limit < 100) {
    // For small limits, use incremental sync instead of sets
    jobType = ETLJobType.INCREMENTAL_SYNC
  }

  try {
    logger.info(`Starting ETL for ${gameCode}`, {
      jobType,
      limit: options.limit,
      skipImages: options.skipImages,
      forceUpdate: options.forceUpdate
    })

    const result = await etlService.startETLJob(gameCode, jobType as any, 'manual', options.limit)

    logger.info(`ETL completed for ${gameCode}`, {
      success: result.success,
      totalProcessed: result.totalProcessed,
      cardsCreated: result.cardsCreated,
      cardsUpdated: result.cardsUpdated,
      printsCreated: result.printsCreated,
      printsUpdated: result.printsUpdated,
      skusGenerated: result.skusGenerated,
      imagesQueued: result.imagesQueued,
      duration: result.duration,
      errors: result.errors.length
    })

    if (result.errors.length > 0) {
      logger.warn(`ETL for ${gameCode} completed with errors:`)
      result.errors.forEach((error, index) => {
        logger.warn(`Error ${index + 1}: ${error.message}`, { 
          type: error.type,
          retryable: error.retryable,
          details: error.details
        })
      })
    }

  } catch (error) {
    logger.error(`ETL failed for ${gameCode}`, error as Error)
    throw error
  }
}

async function main(): Promise<void> {
  program
    .name('master-etl')
    .description('Master ETL script for SideDecked TCG catalog')
    .option('-g, --game <games>', 'Comma-separated list of game codes (MTG,POKEMON,YUGIOH,OPTCG)')
    .option('-a, --all', 'Import all games')
    .option('-l, --limit <number>', 'Limit number of cards to import per game')
    .option('-t, --type <type>', 'ETL job type (full_sync, incremental_sync, banlist_update)', 'incremental_sync')
    .option('--skip-images', 'Skip image processing')
    .option('--force-update', 'Force update existing cards')
    .option('--dry-run', 'Show what would be imported without actually importing')

  program.parse()

  const options = program.opts() as ETLOptions & { dryRun?: boolean }
  
  // Parse limit as number
  if (options.limit) {
    options.limit = parseInt(options.limit as any, 10)
  }

  try {
    // Initialize database
    await initializeDatabase()

    // Ensure games exist in database
    await ensureGamesExist()

    // Determine which games to process
    const availableGames = await getAvailableGames()
    let gamesToProcess: Game[] = []

    if (options.all) {
      gamesToProcess = availableGames
      logger.info('Processing all available games', {
        games: availableGames.map(g => g.code)
      })
    } else if (options.game) {
      const requestedCodes = Array.isArray(options.game) ? options.game : (options.game as string).split(',')
      gamesToProcess = availableGames.filter(game => 
        requestedCodes.includes(game.code)
      )
      
      if (gamesToProcess.length === 0) {
        console.error('No valid games found. Requested:', requestedCodes, 'Available:', availableGames.map(g => g.code))
        process.exit(1)
      }

      logger.info('Processing selected games', {
        games: gamesToProcess.map(g => g.code)
      })
    } else {
      console.error('Must specify either --game or --all')
      program.help()
      process.exit(1)
    }

    // Dry run check
    if (options.dryRun) {
      logger.info('DRY RUN - Would process the following:', {
        games: gamesToProcess.map(g => `${g.name} (${g.code})`),
        type: options.type || 'incremental',
        limit: options.limit || 'unlimited',
        skipImages: options.skipImages || false,
        forceUpdate: options.forceUpdate || false
      })
      process.exit(0)
    }

    // Process each game
    const results: { game: string, success: boolean, error?: string }[] = []

    for (const game of gamesToProcess) {
      try {
        await runETLForGame(game.code, options)
        results.push({ game: game.code, success: true })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        results.push({ game: game.code, success: false, error: errorMessage })
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    logger.info('ETL Master Script Completed', {
      totalGames: results.length,
      successful,
      failed,
      results: results.map(r => ({
        game: r.game,
        status: r.success ? 'SUCCESS' : 'FAILED',
        error: r.error
      }))
    })

    if (failed > 0) {
      process.exit(1)
    }

  } catch (error) {
    console.error('Master ETL script failed:', error)
    process.exit(1)
  } finally {
    // Clean up database connection
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy()
    }
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  process.exit(1)
})

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error in main:', error)
    process.exit(1)
  })
}
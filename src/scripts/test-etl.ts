#!/usr/bin/env npx ts-node

import 'reflect-metadata'
import { initializeDatabase, closeDatabase, AppDataSource } from '../config/database'
import { Game } from '../entities/Game'
import { ETLJobType } from '../entities/ETLJob'

// Import ETL service directly from source - using ts files since dist isn't building
// TODO: Fix package imports after restructuring
// import { ETLService } from '../../packages/tcg-catalog/src/services/ETLService'
const ETLService: any = null // Temporary placeholder

interface TestConfig {
  gameCode: string
  jobType: ETLJobType
  batchSize: number
  skipImages: boolean
}

const TEST_CONFIGS: TestConfig[] = [
  { gameCode: 'MTG', jobType: ETLJobType.INCREMENTAL_SYNC, batchSize: 20, skipImages: true },
  { gameCode: 'POKEMON', jobType: ETLJobType.INCREMENTAL_SYNC, batchSize: 20, skipImages: true },
  { gameCode: 'YUGIOH', jobType: ETLJobType.INCREMENTAL_SYNC, batchSize: 20, skipImages: true },
  { gameCode: 'OPTCG', jobType: ETLJobType.INCREMENTAL_SYNC, batchSize: 20, skipImages: true }
]

async function ensureGamesExist(): Promise<void> {
  const gameRepository = AppDataSource.getRepository(Game)
  
  const games = [
    {
      code: 'MTG',
      name: 'Magic: The Gathering',
      displayName: 'Magic: The Gathering',
      apiProvider: 'scryfall',
      isActive: true
    },
    {
      code: 'POKEMON',
      name: 'Pokémon Trading Card Game',
      displayName: 'Pokémon',
      apiProvider: 'pokemon_tcg',
      isActive: true
    },
    {
      code: 'YUGIOH',
      name: 'Yu-Gi-Oh! Trading Card Game',
      displayName: 'Yu-Gi-Oh!',
      apiProvider: 'ygoprodeck',
      isActive: true
    },
    {
      code: 'OPTCG',
      name: 'One Piece Card Game',
      displayName: 'One Piece',
      apiProvider: 'onepiece_tcg',
      isActive: true
    }
  ]

  for (const gameData of games) {
    const existingGame = await gameRepository.findOne({ where: { code: gameData.code } })
    
    if (!existingGame) {
      const game = gameRepository.create(gameData)
      await gameRepository.save(game)
      console.log(`✅ Created game: ${gameData.name}`)
    } else {
      console.log(`ℹ️  Game already exists: ${gameData.name}`)
    }
  }
}

async function testETLForGame(config: TestConfig): Promise<void> {
  console.log(`\n🎮 Testing ETL for ${config.gameCode}`)
  console.log(`📦 Batch size: ${config.batchSize}`)
  console.log(`🖼️  Skip images: ${config.skipImages}`)
  
  const etlService = new ETLService({
    batchSize: config.batchSize,
    skipImages: config.skipImages,
    rateLimitDelay: 1000, // 1 second between requests
    concurrency: 1, // Single threaded for testing
    forceUpdate: false // Don't overwrite existing data
  })

  try {
    const startTime = Date.now()
    
    const result = await etlService.startETLJob(
      config.gameCode,
      config.jobType,
      'test-script'
    )
    
    const duration = Date.now() - startTime
    
    console.log(`✅ ETL completed for ${config.gameCode}`)
    console.log(`📊 Results:`)
    console.log(`   • Total processed: ${result.totalProcessed}`)
    console.log(`   • Cards created: ${result.cardsCreated}`)
    console.log(`   • Cards updated: ${result.cardsUpdated}`)
    console.log(`   • Prints created: ${result.printsCreated}`)
    console.log(`   • Prints updated: ${result.printsUpdated}`)
    console.log(`   • SKUs generated: ${result.skusGenerated}`)
    console.log(`   • Images queued: ${result.imagesQueued}`)
    console.log(`   • Duration: ${duration}ms`)
    console.log(`   • Errors: ${result.errors.length}`)
    
    if (result.errors.length > 0) {
      console.log(`❌ Errors encountered:`)
      result.errors.forEach((error: any, index: number) => {
        console.log(`   ${index + 1}. ${error.type}: ${error.message}`)
      })
    }
    
    return
    
  } catch (error) {
    console.error(`❌ ETL failed for ${config.gameCode}:`, error)
    throw error
  }
}

async function testAllGames(): Promise<void> {
  console.log('🚀 Starting ETL testing for all games')
  
  for (const config of TEST_CONFIGS) {
    try {
      await testETLForGame(config)
      
      // Wait between games to avoid overwhelming APIs
      console.log('⏳ Waiting 3 seconds before next game...')
      await new Promise(resolve => setTimeout(resolve, 3000))
      
    } catch (error) {
      console.error(`❌ Failed to test ${config.gameCode}:`, error)
      // Continue with other games
    }
  }
}

async function testSingleGame(gameCode: string): Promise<void> {
  const config = TEST_CONFIGS.find(c => c.gameCode === gameCode)
  
  if (!config) {
    console.error(`❌ Game not found: ${gameCode}`)
    console.log(`Available games: ${TEST_CONFIGS.map(c => c.gameCode).join(', ')}`)
    return
  }
  
  console.log(`🚀 Testing ETL for single game: ${gameCode}`)
  await testETLForGame(config)
}

async function main(): Promise<void> {
  try {
    // Initialize database
    await initializeDatabase()
    
    // Ensure games exist in database
    await ensureGamesExist()
    
    // Get command line arguments
    const gameCode = process.argv[2]?.toUpperCase()
    
    if (gameCode) {
      await testSingleGame(gameCode)
    } else {
      await testAllGames()
    }
    
  } catch (error) {
    console.error('❌ Test script failed:', error)
    process.exit(1)
  } finally {
    await closeDatabase()
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n⏹️  Received SIGINT, closing database...')
  await closeDatabase()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n⏹️  Received SIGTERM, closing database...')
  await closeDatabase()
  process.exit(0)
})

// Run the script
if (require.main === module) {
  main()
}

export { testETLForGame, testAllGames, testSingleGame }
#!/usr/bin/env ts-node
/**
 * Image Synchronization Script
 * 
 * This script finds and queues unprocessed images for existing cards in the database.
 * It addresses the issue where ETL pipeline skips duplicate cards, preventing image processing.
 * 
 * Usage:
 *   npm run sync:images                    # Sync all games
 *   npm run sync:images -- --game MTG     # Sync specific game
 *   npm run sync:images -- --dry-run      # Preview what would be synced
 *   tsx src/scripts/sync-images.ts --help # Show help
 */

import { AppDataSource } from '../config/database'
import { ETLService } from '../../packages/tcg-catalog/src/services/ETLService'
import { ImageSyncService } from '../../packages/tcg-catalog/src/services/ImageSyncService'
import { ETLJobType } from '../entities/ETLJob'
import { logger } from '../../packages/tcg-catalog/src/utils/Logger'
import { program } from 'commander'

interface SyncOptions {
  game?: string
  dryRun: boolean
  batchSize: number
  forceReprocess: boolean
  status: boolean
  verbose: boolean
}

class ImageSyncCLI {
  async run(): Promise<void> {
    // Configure command line options
    program
      .name('sync-images')
      .description('Synchronize unprocessed card images')
      .version('1.0.0')
      .option('-g, --game <game>', 'Specific game to sync (MTG, POKEMON, YUGIOH, ONEPIECE)')
      .option('-d, --dry-run', 'Preview what would be synced without actually queueing images', false)
      .option('-b, --batch-size <size>', 'Number of prints to process per batch', '100')
      .option('-f, --force-reprocess', 'Force reprocessing of failed/pending images', false)
      .option('-s, --status', 'Show current image sync status only', false)
      .option('-v, --verbose', 'Enable verbose logging', false)
      .parse()

    const options = program.opts<SyncOptions>()
    options.batchSize = parseInt(options.batchSize.toString()) || 100

    try {
      // Initialize database
      if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize()
        console.log('📊 Database connection established')
      }

      // Show status if requested
      if (options.status) {
        await this.showSyncStatus(options)
        return
      }

      // Run image synchronization
      await this.runImageSync(options)

    } catch (error) {
      logger.error('Image sync script failed', error as Error)
      console.error('❌ Error:', (error as Error).message)
      process.exit(1)
    } finally {
      // Clean up database connection
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy()
      }
    }
  }

  private async showSyncStatus(options: SyncOptions): Promise<void> {
    console.log('\n📊 IMAGE SYNC STATUS')
    console.log('='.repeat(60))

    try {
      const imageSyncService = new ImageSyncService({
        gameCode: options.game
      })

      const status = await imageSyncService.getSyncStatus()

      console.log(`\nOverall Statistics:`)
      console.log(`  Total Prints: ${status.totalPrints.toLocaleString()}`)
      console.log(`  Prints with Images: ${status.printsWithImages.toLocaleString()}`)
      console.log(`  Prints with External Images: ${status.printsWithExternalImages.toLocaleString()}`)
      console.log(`  Prints without Images: ${status.printsWithoutImages.toLocaleString()}`)
      console.log(`  Failed Image Processing: ${status.failedImageProcessing.toLocaleString()}`)
      console.log(`  Pending Image Processing: ${status.pendingImageProcessing.toLocaleString()}`)

      const needProcessing = status.printsWithExternalImages + status.printsWithoutImages + status.failedImageProcessing
      const processedPercent = status.totalPrints > 0 
        ? Math.round((status.printsWithImages / status.totalPrints) * 100)
        : 0

      console.log(`\n📈 Progress:`)
      console.log(`  Processed: ${processedPercent}%`)
      console.log(`  Need Processing: ${needProcessing.toLocaleString()} prints`)

      if (needProcessing > 0) {
        console.log(`\n💡 Recommendation:`)
        if (options.game) {
          console.log(`  Run: npm run sync:images -- --game ${options.game}`)
        } else {
          console.log(`  Run: npm run sync:images`)
        }
      } else {
        console.log(`\n✅ All images are processed!`)
      }

    } catch (error) {
      console.error('❌ Failed to get sync status:', (error as Error).message)
    }
  }

  private async runImageSync(options: SyncOptions): Promise<void> {
    console.log('\n🖼️ STARTING IMAGE SYNCHRONIZATION')
    console.log('='.repeat(60))
    
    if (options.dryRun) {
      console.log('🔍 DRY RUN MODE - No images will be actually queued')
    }

    if (options.verbose) {
      console.log('🔍 Verbose mode enabled')
    }

    const startTime = Date.now()

    try {
      if (options.game) {
        // Sync specific game
        await this.syncGame(options.game, options)
      } else {
        // Sync all games
        const games = ['MTG', 'POKEMON', 'YUGIOH', 'ONEPIECE']
        for (const gameCode of games) {
          await this.syncGame(gameCode, options)
          console.log() // Empty line between games
        }
      }

      const duration = Date.now() - startTime
      console.log(`\n✅ Image synchronization completed in ${Math.round(duration / 1000)}s`)

      if (!options.dryRun) {
        console.log('\n💡 Next steps:')
        console.log('  1. Start the image worker: npm run worker:images')
        console.log('  2. Monitor processing progress in the logs')
        console.log('  3. Check MinIO storage for processed images')
      }

    } catch (error) {
      console.error('❌ Image synchronization failed:', (error as Error).message)
      throw error
    }
  }

  private async syncGame(gameCode: string, options: SyncOptions): Promise<void> {
    console.log(`🎮 Processing ${gameCode}...`)

    try {
      if (options.dryRun) {
        // Use ImageSyncService directly for dry run
        const imageSyncService = new ImageSyncService({
          gameCode,
          batchSize: options.batchSize,
          dryRun: true,
          forceReprocess: options.forceReprocess
        })

        const result = await imageSyncService.syncImages()
        
        console.log(`  📊 ${gameCode} Results (DRY RUN):`)
        console.log(`    Prints Scanned: ${result.totalPrintsScanned.toLocaleString()}`)
        console.log(`    Prints Needing Images: ${result.printsNeedingImages.toLocaleString()}`)
        console.log(`    Would Queue: ${result.printsNeedingImages.toLocaleString()} images`)
        
        if (result.errors.length > 0) {
          console.log(`    Errors: ${result.errors.length}`)
          if (options.verbose) {
            result.errors.forEach(error => console.log(`      - ${error}`))
          }
        }

      } else {
        // Use ETLService for actual sync (creates job tracking)
        const etlService = new ETLService({
          batchSize: options.batchSize,
          forceUpdate: options.forceReprocess,
          skipImages: false
        })

        const result = await etlService.startETLJob(
          gameCode,
          ETLJobType.IMAGE_SYNC,
          'manual'
        )

        console.log(`  📊 ${gameCode} Results:`)
        console.log(`    Prints Scanned: ${result.totalProcessed.toLocaleString()}`)
        console.log(`    Images Queued: ${result.imagesQueued.toLocaleString()}`)
        console.log(`    Duration: ${Math.round(result.duration / 1000)}s`)
        console.log(`    Success: ${result.success ? '✅' : '❌'}`)

        if (result.errors.length > 0) {
          console.log(`    Errors: ${result.errors.length}`)
          if (options.verbose) {
            result.errors.forEach(error => {
              console.log(`      - ${error.message}`)
            })
          }
        }
      }

    } catch (error) {
      console.error(`❌ Failed to sync ${gameCode}:`, (error as Error).message)
      throw error
    }
  }
}

// Show help if no arguments provided
if (process.argv.length === 2) {
  program.help()
}

// Run the CLI
if (require.main === module) {
  const cli = new ImageSyncCLI()
  
  cli.run().then(() => {
    process.exit(0)
  }).catch(error => {
    console.error('Image sync failed:', error)
    process.exit(1)
  })
}

export default ImageSyncCLI
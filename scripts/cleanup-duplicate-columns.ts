#!/usr/bin/env ts-node
/**
 * Cleanup Duplicate Database Columns Script
 * 
 * This script removes the duplicate snake_case columns that were created as a workaround
 * for the schema mismatch. Now that we're using TypeORM properly with entity relationships,
 * these duplicate columns are no longer needed.
 * 
 * Columns to remove:
 * - cards.game_id (use gameId column + TypeORM @JoinColumn)
 * - prints.card_id (use cardId column + TypeORM @JoinColumn) 
 * - prints.set_id (use setId column + TypeORM @JoinColumn)
 * - card_sets.game_id (use gameId column + TypeORM @JoinColumn)
 */

import { AppDataSource } from '../src/config/database'

async function cleanupDuplicateColumns(): Promise<void> {
  try {
    await AppDataSource.initialize()
    console.log('🗄️  Database connection established')

    console.log('\n=== REMOVING DUPLICATE SNAKE_CASE COLUMNS ===')

    // Remove cards.game_id (duplicate of gameId)
    console.log('Removing cards.game_id column...')
    await AppDataSource.query(`ALTER TABLE cards DROP COLUMN IF EXISTS game_id`)
    console.log('✅ Removed cards.game_id')

    // Remove prints.card_id (duplicate of cardId) 
    console.log('Removing prints.card_id column...')
    await AppDataSource.query(`ALTER TABLE prints DROP COLUMN IF EXISTS card_id`)
    console.log('✅ Removed prints.card_id')

    // Remove prints.set_id (duplicate of setId)
    console.log('Removing prints.set_id column...')
    await AppDataSource.query(`ALTER TABLE prints DROP COLUMN IF EXISTS set_id`)
    console.log('✅ Removed prints.set_id')

    // Remove card_sets.game_id (duplicate of gameId)
    console.log('Removing card_sets.game_id column...')
    await AppDataSource.query(`ALTER TABLE card_sets DROP COLUMN IF EXISTS game_id`)
    console.log('✅ Removed card_sets.game_id')

    console.log('\n=== VERIFICATION ===')

    // Verify that TypeORM relationships still work
    const { Card } = await import('../src/entities/Card')
    const cardRepository = AppDataSource.getRepository(Card)
    
    const testCard = await cardRepository.findOne({
      where: { name: '+2 Mace' },
      relations: ['game', 'prints', 'prints.set']
    })

    if (testCard && testCard.game && testCard.prints?.length > 0) {
      console.log(`✅ TypeORM relationships working: ${testCard.name} (${testCard.game.code}) with ${testCard.prints.length} prints`)
    } else {
      console.log('⚠️  TypeORM relationships may need adjustment')
    }

    await AppDataSource.destroy()
    console.log('\n✅ Database cleanup completed successfully!')
    console.log('The API now uses TypeORM properly without duplicate columns.')
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  cleanupDuplicateColumns()
}

export { cleanupDuplicateColumns }
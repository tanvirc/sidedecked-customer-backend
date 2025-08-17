require('dotenv').config();
const { AppDataSource } = require('../dist/src/config/database');

async function runCleanup() {
  try {
    await AppDataSource.initialize();
    console.log('🗄️  Database connection established');
    console.log('\n=== REMOVING DUPLICATE SNAKE_CASE COLUMNS ===');

    // Remove cards.game_id (duplicate of gameId)
    console.log('Removing cards.game_id column...');
    await AppDataSource.query(`ALTER TABLE cards DROP COLUMN IF EXISTS game_id`);
    console.log('✅ Removed cards.game_id');

    // Remove prints.card_id (duplicate of cardId) 
    console.log('Removing prints.card_id column...');
    await AppDataSource.query(`ALTER TABLE prints DROP COLUMN IF EXISTS card_id`);
    console.log('✅ Removed prints.card_id');

    // Remove prints.set_id (duplicate of setId)
    console.log('Removing prints.set_id column...');
    await AppDataSource.query(`ALTER TABLE prints DROP COLUMN IF EXISTS set_id`);
    console.log('✅ Removed prints.set_id');

    // Remove card_sets.game_id (duplicate of gameId)
    console.log('Removing card_sets.game_id column...');
    await AppDataSource.query(`ALTER TABLE card_sets DROP COLUMN IF EXISTS game_id`);
    console.log('✅ Removed card_sets.game_id');

    console.log('\n=== VERIFICATION ===');
    
    // Test TypeORM relationships
    const Card = require('../dist/src/entities/Card').Card;
    const cardRepository = AppDataSource.getRepository(Card);
    
    const testCard = await cardRepository.findOne({
      where: { name: '+2 Mace' },
      relations: ['game', 'prints', 'prints.set']
    });

    if (testCard && testCard.game && testCard.prints?.length > 0) {
      console.log(`✅ TypeORM relationships working: ${testCard.name} (${testCard.game.code}) with ${testCard.prints.length} prints`);
    } else {
      console.log('⚠️  TypeORM relationships may need adjustment');
    }

    await AppDataSource.destroy();
    console.log('\n✅ Database cleanup completed successfully!');
    console.log('The API now uses TypeORM properly without duplicate columns.');
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

runCleanup();
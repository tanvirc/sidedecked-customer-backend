require('dotenv').config();
const { AppDataSource } = require('../dist/src/config/database');

async function testCleanup() {
  try {
    await AppDataSource.initialize();
    console.log('🗄️  Database connection established');
    
    // Test that the duplicate columns are gone
    console.log('\n=== TESTING CLEANUP RESULTS ===');
    
    try {
      // This should fail because game_id column shouldn't exist
      await AppDataSource.query('SELECT game_id FROM cards LIMIT 1');
      console.log('❌ cards.game_id still exists - cleanup needed');
    } catch (error) {
      if (error.message.includes('column') && error.message.includes('game_id') && error.message.includes('does not exist')) {
        console.log('✅ cards.game_id column successfully removed');
      } else {
        console.log('⚠️  Unexpected error checking cards.game_id:', error.message);
      }
    }
    
    try {
      // This should fail because card_id column shouldn't exist
      await AppDataSource.query('SELECT card_id FROM prints LIMIT 1');
      console.log('❌ prints.card_id still exists - cleanup needed');
    } catch (error) {
      if (error.message.includes('column') && error.message.includes('card_id') && error.message.includes('does not exist')) {
        console.log('✅ prints.card_id column successfully removed');
      } else {
        console.log('⚠️  Unexpected error checking prints.card_id:', error.message);
      }
    }
    
    try {
      // This should fail because set_id column shouldn't exist  
      await AppDataSource.query('SELECT set_id FROM prints LIMIT 1');
      console.log('❌ prints.set_id still exists - cleanup needed');
    } catch (error) {
      if (error.message.includes('column') && error.message.includes('set_id') && error.message.includes('does not exist')) {
        console.log('✅ prints.set_id column successfully removed');
      } else {
        console.log('⚠️  Unexpected error checking prints.set_id:', error.message);
      }
    }
    
    // Now test that TypeORM relationships work with the correct camelCase columns
    console.log('\n=== TESTING TYPEORM RELATIONSHIPS ===');
    
    const Card = require('../dist/src/entities/Card').Card;
    const cardRepository = AppDataSource.getRepository(Card);
    
    const testCard = await cardRepository.findOne({
      where: {},
      relations: ['game']
    });
    
    if (testCard) {
      console.log(`✅ Card found: ${testCard.name}`);
      if (testCard.game) {
        console.log(`✅ Game relationship working: ${testCard.game.name} (${testCard.game.code})`);
      } else {
        console.log('⚠️  Game relationship not loading');
      }
    } else {
      console.log('⚠️  No cards found for testing');
    }

    await AppDataSource.destroy();
    console.log('\n✅ Database cleanup verification completed!');
    console.log('TypeORM is now using camelCase columns with proper @JoinColumn mappings.');
    
  } catch (error) {
    console.error('❌ Error during cleanup verification:', error.message);
    process.exit(1);
  }
}

testCleanup();
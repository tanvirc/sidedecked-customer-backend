const { createConnection } = require('typeorm');

async function runCleanup() {
  try {
    // Connect to database using environment variables
    const connection = await createConnection({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      logging: true
    });

    console.log('🗄️  Database connection established');
    console.log('\n=== REMOVING DUPLICATE SNAKE_CASE COLUMNS ===');

    // Remove cards.game_id (duplicate of gameId)
    console.log('Removing cards.game_id column...');
    await connection.query(`ALTER TABLE cards DROP COLUMN IF EXISTS game_id`);
    console.log('✅ Removed cards.game_id');

    // Remove prints.card_id (duplicate of cardId) 
    console.log('Removing prints.card_id column...');
    await connection.query(`ALTER TABLE prints DROP COLUMN IF EXISTS card_id`);
    console.log('✅ Removed prints.card_id');

    // Remove prints.set_id (duplicate of setId)
    console.log('Removing prints.set_id column...');
    await connection.query(`ALTER TABLE prints DROP COLUMN IF EXISTS set_id`);
    console.log('✅ Removed prints.set_id');

    // Remove card_sets.game_id (duplicate of gameId)
    console.log('Removing card_sets.game_id column...');
    await connection.query(`ALTER TABLE card_sets DROP COLUMN IF EXISTS game_id`);
    console.log('✅ Removed card_sets.game_id');

    await connection.close();
    console.log('\n✅ Database cleanup completed successfully!');
    console.log('The API now uses TypeORM properly without duplicate columns.');
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

runCleanup();
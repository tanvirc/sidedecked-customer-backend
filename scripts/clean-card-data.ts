import 'reflect-metadata';
import { AppDataSource } from '../src/config/database';

async function cleanCardData() {
  try {
    await AppDataSource.initialize();
    console.log('✅ Connected to database');
    
    // Delete in correct order to respect foreign key constraints
    const tables = [
      'card_images',
      'catalog_skus', 
      'prints',
      'cards',
      'card_sets',
      'formats',
      'games'
    ];
    
    for (const table of tables) {
      try {
        const result = await AppDataSource.query(`DELETE FROM ${table}`);
        console.log(`✅ Deleted from ${table}`);
      } catch (error) {
        console.log(`⚠️  Table ${table} might not exist or is already empty`);
      }
    }
    
    console.log('✅ All card data deleted successfully');
    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

cleanCardData();
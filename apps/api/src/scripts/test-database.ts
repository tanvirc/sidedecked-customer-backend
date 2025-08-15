#!/usr/bin/env npx ts-node

/**
 * Simple database connectivity test
 */

import 'reflect-metadata'
import { DataSource } from 'typeorm'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/sidedecked_db'

// Test with a simplified data source
const TestDataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  synchronize: false,
  logging: true,
  entities: [] // No entities needed for connectivity test
})

async function testDatabaseConnection(): Promise<void> {
  console.log('🔌 Testing database connectivity...')
  console.log(`Database URL: ${DATABASE_URL.replace(/:[^:@]*@/, ':***@')}`)
  
  try {
    await TestDataSource.initialize()
    console.log('✅ Database connection successful!')
    
    // Test a simple query
    const result = await TestDataSource.query('SELECT NOW() as current_time')
    console.log(`✅ Database query successful: ${result[0]?.current_time}`)
    
    // Check if database exists and has tables
    const tables = await TestDataSource.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    
    console.log(`📊 Found ${tables.length} tables in database`)
    if (tables.length > 0) {
      console.log('   Tables:', tables.map((t: any) => t.table_name).join(', '))
    } else {
      console.log('   ⚠️  No tables found - database needs to be migrated')
    }
    
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    
    if (error instanceof Error) {
      if (error.message.includes('ENOTFOUND')) {
        console.log('💡 Suggestion: Check if database host is accessible')
      } else if (error.message.includes('authentication failed')) {
        console.log('💡 Suggestion: Check database credentials')
      } else if (error.message.includes('database') && error.message.includes('does not exist')) {
        console.log('💡 Suggestion: Create the database first')
      } else if (error.message.includes('ECONNREFUSED')) {
        console.log('💡 Suggestion: Check if PostgreSQL is running')
      }
    }
    
    throw error
  } finally {
    if (TestDataSource.isInitialized) {
      await TestDataSource.destroy()
      console.log('🔌 Database connection closed')
    }
  }
}

async function main(): Promise<void> {
  try {
    await testDatabaseConnection()
    
    console.log('\n📝 Next Steps:')
    console.log('   1. ✅ Database connectivity verified')
    console.log('   2. Run migrations to create tables: npm run migration:run')
    console.log('   3. Test ETL pipeline with small batches')
    
  } catch (error) {
    console.log('\n📝 Next Steps:')
    console.log('   1. ❌ Fix database connectivity issues')
    console.log('   2. Set up PostgreSQL database if not exists')
    console.log('   3. Update DATABASE_URL in environment variables')
    process.exit(1)
  }
}

// Run the script
main().catch(error => {
  console.error('❌ Database test failed:', error)
  process.exit(1)
})
#!/usr/bin/env npx ts-node

import 'reflect-metadata'
import { DataSource } from 'typeorm'
import dotenv from 'dotenv'

dotenv.config()

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/sidedecked_db'

const TestDataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  synchronize: false,
  logging: false,
  entities: []
})

async function checkDatabaseState(): Promise<void> {
  try {
    await TestDataSource.initialize()
    console.log('🔌 Connected to database')

    // Get all tables
    const tables = await TestDataSource.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)

    console.log(`📊 Found ${tables.length} tables:`)
    tables.forEach((table: any) => {
      console.log(`   • ${table.table_name}`)
    })

    // Check if specific tables exist
    const expectedTables = ['games', 'cards', 'prints', 'card_sets', 'catalog_skus', 'etl_jobs']
    
    for (const tableName of expectedTables) {
      try {
        const result = await TestDataSource.query(`SELECT COUNT(*) FROM ${tableName}`)
        console.log(`✅ ${tableName}: ${result[0].count} records`)
      } catch (error) {
        console.log(`❌ ${tableName}: does not exist`)
      }
    }

    // Check migration status
    try {
      const migrations = await TestDataSource.query(`
        SELECT id, name, timestamp 
        FROM migrations 
        ORDER BY timestamp DESC
      `)
      
      console.log(`\n📋 Migration history (${migrations.length} entries):`)
      migrations.forEach((migration: any) => {
        console.log(`   • ${migration.name} (${new Date(parseInt(migration.timestamp)).toISOString()})`)
      })
    } catch (error) {
      console.log('\n📋 No migration history found')
    }

  } catch (error) {
    console.error('❌ Database check failed:', error)
  } finally {
    if (TestDataSource.isInitialized) {
      await TestDataSource.destroy()
    }
  }
}

checkDatabaseState()
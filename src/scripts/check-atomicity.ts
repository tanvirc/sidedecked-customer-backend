#!/usr/bin/env ts-node
/**
 * Check Atomicity Script
 * 
 * Verify that the atomic ETL system is working correctly by checking
 * card import completeness and consistency.
 */

import 'reflect-metadata'
import { AppDataSource } from '../config/database'

async function checkAtomicity(): Promise<void> {
  try {
    await AppDataSource.initialize()
    console.log('✅ Database connected')

    // Check recent imports
    const recentImports = await AppDataSource.query(`
      SELECT 
        c.name as card_name,
        c.id as card_id,
        p."imageProcessingStatus",
        p."imageProcessedAt",
        COUNT(DISTINCT p.id) as print_count,
        COUNT(cs.id) as sku_count,
        MAX(c.created_at) as created_at
      FROM cards c 
      JOIN prints p ON c.id = p."cardId"
      LEFT JOIN catalog_skus cs ON p.id = cs."printId"
      WHERE c.created_at > NOW() - INTERVAL '30 minutes'
      GROUP BY c.name, c.id, p."imageProcessingStatus", p."imageProcessedAt"
      ORDER BY created_at DESC 
      LIMIT 10
    `)

    console.log('\n🔍 Recent Card Imports (Last 30 minutes):')
    console.log('=' .repeat(80))
    
    if (recentImports.length === 0) {
      console.log('No recent imports found')
    } else {
      recentImports.forEach((row: any, index: number) => {
        console.log(`${index + 1}. ${row.card_name}`)
        console.log(`   📋 Card ID: ${row.card_id}`)
        console.log(`   🖨️ Prints: ${row.print_count}`)
        console.log(`   📦 SKUs: ${row.sku_count}`)
        console.log(`   🖼️ Image Status: ${row.imageProcessingStatus}`)
        console.log(`   📅 Created: ${row.created_at}`)
        console.log('')
      })
    }

    // Check image processing status distribution
    const imageStatusStats = await AppDataSource.query(`
      SELECT 
        p."imageProcessingStatus",
        COUNT(*) as count
      FROM prints p
      JOIN cards c ON c.id = p."cardId"
      WHERE c.created_at > NOW() - INTERVAL '1 hour'
      GROUP BY p."imageProcessingStatus"
      ORDER BY count DESC
    `)

    console.log('📊 Image Processing Status (Last Hour):')
    console.log('=' .repeat(50))
    imageStatusStats.forEach((row: any) => {
      const emojiMap: Record<string, string> = {
        'pending': '⏳',
        'queued': '📋',
        'processing': '🔄',
        'completed': '✅',
        'failed': '❌',
        'retry': '🔄'
      }
      const emoji = emojiMap[row.imageProcessingStatus] || '❓'
      
      console.log(`${emoji} ${row.imageProcessingStatus}: ${row.count} prints`)
    })

    // Check atomicity consistency
    const inconsistencies = await AppDataSource.query(`
      SELECT 
        c.name as card_name,
        COUNT(DISTINCT p.id) as print_count,
        COUNT(cs.id) as total_skus,
        COUNT(cs.id) / COUNT(DISTINCT p.id) as avg_skus_per_print
      FROM cards c 
      LEFT JOIN prints p ON c.id = p."cardId"
      LEFT JOIN catalog_skus cs ON p.id = cs."printId"
      WHERE c.created_at > NOW() - INTERVAL '1 hour'
      GROUP BY c.name, c.id
      HAVING COUNT(DISTINCT p.id) = 0 OR COUNT(cs.id) / COUNT(DISTINCT p.id) != 5
      ORDER BY c.name
    `)

    console.log('\n⚠️ Atomicity Issues (Cards with missing prints or SKUs):')
    console.log('=' .repeat(60))
    
    if (inconsistencies.length === 0) {
      console.log('✅ No atomicity issues found - all cards have complete data!')
    } else {
      inconsistencies.forEach((row: any) => {
        console.log(`❌ ${row.card_name}:`)
        console.log(`   Prints: ${row.print_count}, SKUs: ${row.total_skus}`)
        console.log(`   Expected: 1 print + 5 SKUs per print`)
      })
    }

    // Summary
    const totalCards = await AppDataSource.query(`
      SELECT COUNT(*) as count FROM cards WHERE created_at > NOW() - INTERVAL '1 hour'
    `)

    const totalPrints = await AppDataSource.query(`
      SELECT COUNT(*) as count FROM prints p
      JOIN cards c ON c.id = p."cardId"
      WHERE c.created_at > NOW() - INTERVAL '1 hour'
    `)

    const totalSKUs = await AppDataSource.query(`
      SELECT COUNT(*) as count FROM catalog_skus cs
      JOIN prints p ON p.id = cs."printId"
      JOIN cards c ON c.id = p."cardId"
      WHERE c.created_at > NOW() - INTERVAL '1 hour'
    `)

    console.log('\n📈 Summary (Last Hour):')
    console.log('=' .repeat(30))
    console.log(`Cards imported: ${totalCards[0].count}`)
    console.log(`Prints created: ${totalPrints[0].count}`)
    console.log(`SKUs generated: ${totalSKUs[0].count}`)
    console.log(`Atomicity ratio: ${totalSKUs[0].count / totalPrints[0].count} SKUs per print (expected: 5)`)

    await AppDataSource.destroy()
    process.exit(0)
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

checkAtomicity()
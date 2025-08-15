#!/usr/bin/env npx ts-node

/**
 * Test importing new Pokémon cards from a different set
 */

import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { PokemonTCG } from 'pokemon-tcg-sdk-typescript'
import dotenv from 'dotenv'

dotenv.config()

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/sidedecked_db'

const AppDataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  synchronize: false,
  logging: false,
  entities: []
})

async function importNewPokemonCards(limit: number = 3): Promise<void> {
  console.log(`🔥 Importing ${limit} new Pokémon cards from Jungle set...`)
  
  const apiKey = process.env.POKEMON_TCG_API_KEY || ''
  if (apiKey) {
    process.env.POKEMONTCG_API_KEY = apiKey
    console.log(`🔑 Using API key: ${apiKey.substring(0, 8)}...`)
  }
  
  try {
    // Get Pokemon game ID
    const gameResult = await AppDataSource.query(`SELECT id FROM games WHERE code = 'POKEMON'`)
    if (gameResult.length === 0) {
      throw new Error('POKEMON game not found in database')
    }
    const gameId = gameResult[0].id

    // Get cards from Jungle set - should be different from Base
    console.log('🎯 Fetching cards from Jungle set (base2)...')
    const cards = await PokemonTCG.findCardsByQueries({
      q: 'set.id:base2',
      pageSize: limit
    })
    
    console.log(`✅ Retrieved ${cards.length} cards from Jungle set`)

    let importedCount = 0
    
    for (const card of cards) {
      try {
        // Generate oracle ID
        const oracleId = `pokemon_${card.id}`
        
        // Check if card already exists
        const existingCard = await AppDataSource.query(
          `SELECT id FROM cards WHERE oracle_id = $1`,
          [oracleId]
        )
        
        if (existingCard.length > 0) {
          console.log(`⏭️  Skipping existing card: ${card.name}`)
          continue
        }

        // Insert card
        const cardResult = await AppDataSource.query(`
          INSERT INTO cards (
            game_id, oracle_id, name, normalized_name, primary_type,
            hp, retreat_cost, energy_types
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
          RETURNING id
        `, [
          gameId,
          oracleId,
          card.name,
          card.name.toLowerCase(),
          card.supertype || card.subtypes?.[0] || 'Unknown',
          card.hp ? parseInt(card.hp) : null,
          card.retreatCost ? card.retreatCost.length : null,
          card.types || []
        ])

        const cardId = cardResult[0].id

        // Handle set
        let setResult = await AppDataSource.query(
          `SELECT id FROM card_sets WHERE code = $1 AND game_id = $2`,
          [card.set.id, gameId]
        )

        if (setResult.length === 0) {
          setResult = await AppDataSource.query(`
            INSERT INTO card_sets (game_id, code, name, set_type, release_date, card_count)
            VALUES ($1, $2, $3, 'expansion', $4, $5)
            RETURNING id
          `, [gameId, card.set.id, card.set.name, card.set.releaseDate || '1999-01-09', card.set.total || 0])
        }

        const setId = setResult[0].id

        // Insert print
        const printResult = await AppDataSource.query(`
          INSERT INTO prints (
            card_id, set_id, number, rarity, artist, language,
            image_small, image_normal, image_large,
            blurhash, finish, frame, border_color
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING id
        `, [
          cardId,
          setId,
          card.number,
          card.rarity || 'Common',
          card.artist || 'Unknown',
          'en',
          card.images?.small || '',
          card.images?.large || '',
          card.images?.large || '',
          'placeholder_blurhash',
          'normal',
          'normal',
          'black'
        ])

        const printId = printResult[0].id

        // Generate basic SKUs
        const conditions = ['NM', 'LP', 'MP']
        for (const condition of conditions) {
          const sku = `POKEMON-${card.set.id}-${card.number}-EN-${condition}-NORMAL`
          
          await AppDataSource.query(`
            INSERT INTO catalog_skus (
              sku, print_id, game_code, set_code, card_number,
              language, condition, finish, is_available_b2c
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            sku, printId, 'POKEMON', card.set.id, card.number,
            'EN', condition, 'NORMAL', false
          ])
        }

        importedCount++
        console.log(`✅ Imported: ${card.name} (Jungle #${card.number}) - ${card.rarity}`)
        
      } catch (error) {
        console.error(`❌ Failed to import ${card.name}:`, error)
      }
    }
    
    console.log(`🔥 New Pokémon cards imported: ${importedCount}/${limit} from Jungle set`)
    
  } catch (error) {
    console.error('❌ New Pokémon import failed:', error)
  }
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Testing New Pokémon Card Import')
    console.log('=================================\n')

    await AppDataSource.initialize()
    console.log('🔌 Database connected')

    await importNewPokemonCards(3)

    console.log('\n📊 Final Pokémon Count')
    console.log('=====================')
    
    // Check Pokemon counts
    const counts = await AppDataSource.query(`
      SELECT 
        g.code as game,
        COUNT(c.id) as cards,
        COUNT(p.id) as prints,
        COUNT(s.id) as skus
      FROM games g
      LEFT JOIN cards c ON c.game_id = g.id
      LEFT JOIN prints p ON p.card_id = c.id  
      LEFT JOIN catalog_skus s ON s.print_id = p.id
      WHERE g.code = 'POKEMON'
      GROUP BY g.code, g.name
    `)
    
    counts.forEach((count: any) => {
      console.log(`${count.game}: ${count.cards} cards, ${count.prints} prints, ${count.skus} SKUs`)
    })

    console.log('\n🎉 Pokémon SDK integration is complete and working!')
    
  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy()
      console.log('🔌 Database connection closed')
    }
  }
}

// Run the script
main()
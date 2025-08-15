#!/usr/bin/env npx ts-node

/**
 * Pokémon ETL using official TypeScript SDK
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

class PokemonSDKService {
  private readonly apiKey: string

  constructor() {
    this.apiKey = process.env.POKEMON_TCG_API_KEY || ''
    
    // Configure the SDK with API key
    if (this.apiKey) {
      process.env.POKEMONTCG_API_KEY = this.apiKey
      console.log(`🔑 Using API key: ${this.apiKey.substring(0, 8)}...`)
    } else {
      console.log('⚠️  No API key found - using rate-limited requests')
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async getAvailableSets(): Promise<any[]> {
    try {
      console.log('📋 Fetching available Pokémon sets...')
      const sets = await PokemonTCG.getAllSets()
      
      // Sort by release date (newest first) and filter out empty sets
      const sortedSets = sets
        .filter(set => set.total && set.total > 0)
        .sort((a, b) => {
          const dateA = new Date(a.releaseDate || '1999-01-01').getTime()
          const dateB = new Date(b.releaseDate || '1999-01-01').getTime()
          return dateB - dateA // Newest first
        })
      
      console.log(`📦 Found ${sortedSets.length} sets with cards`)
      return sortedSets.slice(0, 10) // Take top 10 recent sets
    } catch (error) {
      console.error('❌ Failed to fetch sets:', error)
      throw error
    }
  }

  async getCardsFromSet(setId: string, limit: number = 10): Promise<any[]> {
    try {
      console.log(`🔍 Fetching cards from set: ${setId}`)
      
      // Use the SDK's findCardsByQueries method to filter by set
      const cards = await PokemonTCG.findCardsByQueries({
        q: `set.id:${setId}`,
        pageSize: limit
      })
      
      console.log(`✅ Found ${cards.length} cards in set ${setId}`)
      return cards.slice(0, limit)
    } catch (error) {
      console.error(`❌ Failed to fetch cards from set ${setId}:`, error)
      return []
    }
  }

  async findCardsWithQuery(query: string, limit: number = 10): Promise<any[]> {
    try {
      console.log(`🔍 Searching for cards with query: ${query}`)
      
      const cards = await PokemonTCG.findCardsByQueries({
        q: query,
        pageSize: limit
      })
      
      console.log(`✅ Found ${cards.length} cards matching query`)
      return cards.slice(0, limit)
    } catch (error) {
      console.error(`❌ Failed to search cards with query ${query}:`, error)
      return []
    }
  }
}

async function importPokemonCardsSDK(limit: number = 10): Promise<void> {
  console.log(`🔥 Importing ${limit} Pokémon cards using official SDK...`)
  
  const pokemonSDK = new PokemonSDKService()
  
  try {
    // Get Pokemon game ID
    const gameResult = await AppDataSource.query(`SELECT id FROM games WHERE code = 'POKEMON'`)
    if (gameResult.length === 0) {
      throw new Error('POKEMON game not found in database')
    }
    const gameId = gameResult[0].id

    // Strategy 1: Try to get cards from popular/recent sets
    let cards: any[] = []
    let selectedSet = null
    
    try {
      const sets = await pokemonSDK.getAvailableSets()
      
      // Try sets one by one until we find cards
      for (const set of sets.slice(0, 5)) {
        console.log(`🎯 Trying set: ${set.name} (${set.id}) - ${set.total} cards`)
        
        try {
          const setCards = await pokemonSDK.getCardsFromSet(set.id, limit)
          if (setCards.length > 0) {
            cards = setCards
            selectedSet = set
            break
          }
          
          // Rate limiting - wait between requests
          await pokemonSDK['delay'](2000) // Access private method
        } catch (setError) {
          console.log(`⚠️  Set ${set.name} failed, trying next...`)
          continue
        }
      }
    } catch (setsError) {
      console.log('⚠️  Failed to get sets, trying alternative approach...')
    }

    // Strategy 2: If sets approach failed, try popular card search
    if (cards.length === 0) {
      console.log('🔄 Trying alternative approach with popular cards...')
      
      const popularQueries = [
        'supertype:pokemon',
        'name:charizard',
        'name:pikachu', 
        'type:fire',
        'type:water'
      ]
      
      for (const query of popularQueries) {
        try {
          const queryCards = await pokemonSDK.findCardsWithQuery(query, Math.ceil(limit / 2))
          cards.push(...queryCards)
          
          if (cards.length >= limit) {
            cards = cards.slice(0, limit)
            break
          }
          
          // Rate limiting
          await pokemonSDK['delay'](2000)
        } catch (queryError) {
          console.log(`⚠️  Query '${query}' failed, trying next...`)
          continue
        }
      }
    }
    
    if (cards.length === 0) {
      throw new Error('No cards found with any approach')
    }

    console.log(`🎯 Successfully retrieved ${cards.length} cards for import`)
    let importedCount = 0
    
    for (const card of cards.slice(0, limit)) {
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
          `, [gameId, card.set.id, card.set.name, card.set.releaseDate || '2020-01-01', card.set.total || 0])
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
          card.images?.normal || '',
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
        console.log(`✅ Imported: ${card.name} (${card.set.name} #${card.number})`)
        
        // Rate limiting between database operations
        await pokemonSDK['delay'](100)
        
      } catch (error) {
        console.error(`❌ Failed to import ${card.name}:`, error)
      }
    }
    
    const sourceDesc = selectedSet ? `from ${selectedSet.name}` : 'from various sources'
    console.log(`🔥 Pokémon SDK Import complete: ${importedCount}/${limit} cards imported ${sourceDesc}`)
    
  } catch (error) {
    console.error('❌ Pokémon SDK import failed:', error)
    
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        console.log('💡 API authentication failed - check POKEMON_TCG_API_KEY')
      } else if (error.message.includes('429')) {
        console.log('💡 Rate limited - the SDK should handle this, but try again later')
      } else if (error.message.includes('timeout') || error.message.includes('ECONNABORTED')) {
        console.log('💡 Connection timeout - network or API issue')
      }
    }
  }
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Starting Pokémon SDK ETL')
    console.log('=============================\n')

    await AppDataSource.initialize()
    console.log('🔌 Database connected')

    // Test with small batch first
    await importPokemonCardsSDK(10)

    console.log('\n📊 Import Summary')
    console.log('================')
    
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

    console.log('\n🎉 Pokémon SDK ETL completed successfully!')
    
  } catch (error) {
    console.error('❌ ETL failed:', error)
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy()
      console.log('🔌 Database connection closed')
    }
  }
}

// Run the script
main()
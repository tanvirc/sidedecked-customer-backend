#!/usr/bin/env npx ts-node

/**
 * Improved Pokémon ETL with retry logic and better error handling
 */

import 'reflect-metadata'
import { DataSource } from 'typeorm'
import axios from 'axios'
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

interface PokemonCard {
  id: string
  name: string
  supertype: string
  subtypes?: string[]
  hp?: string
  types?: string[]
  retreatCost?: string[]
  set: {
    id: string
    name: string
    releaseDate?: string
    total?: number
  }
  number: string
  artist?: string
  rarity?: string
  images?: {
    small?: string
    normal?: string
    large?: string
  }
}

class PokemonAPIService {
  private readonly baseURL = 'https://api.pokemontcg.io/v2'
  private readonly apiKey = process.env.POKEMON_TCG_API_KEY || ''
  private readonly maxRetries = 3
  private readonly baseDelay = 2000 // 2 seconds
  
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private async makeRequest(endpoint: string, params: any = {}, retryCount = 0): Promise<any> {
    try {
      console.log(`🔄 Attempt ${retryCount + 1}: ${endpoint}`)
      
      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        params,
        timeout: 15000, // 15 second timeout
        headers: {
          'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)',
          'X-Api-Key': this.apiKey
        }
      })

      return response.data
    } catch (error: any) {
      console.error(`❌ Request failed (attempt ${retryCount + 1}):`, error.message)
      
      // Don't retry on 4xx errors (client errors)
      if (error.response && error.response.status >= 400 && error.response.status < 500) {
        throw new Error(`API Error ${error.response.status}: ${error.response.statusText}`)
      }
      
      // Retry on network errors, timeouts, or 5xx errors
      if (retryCount < this.maxRetries) {
        const delayMs = this.baseDelay * Math.pow(2, retryCount) // Exponential backoff
        console.log(`⏳ Retrying in ${delayMs}ms...`)
        await this.delay(delayMs)
        return this.makeRequest(endpoint, params, retryCount + 1)
      }
      
      throw error
    }
  }

  async getCards(options: {
    setId?: string
    page?: number
    pageSize?: number
    orderBy?: string
  } = {}): Promise<{ data: PokemonCard[], totalCount: number }> {
    const params: any = {
      page: options.page || 1,
      pageSize: Math.min(options.pageSize || 10, 25), // Max 25 per request
      orderBy: options.orderBy || 'set.releaseDate,-number'
    }
    
    if (options.setId) {
      params.q = `set.id:${options.setId}`
    }
    
    const result = await this.makeRequest('/cards', params)
    
    return {
      data: result.data || [],
      totalCount: result.totalCount || 0
    }
  }

  async getSets(): Promise<any[]> {
    const result = await this.makeRequest('/sets', { orderBy: '-releaseDate' })
    return result.data || []
  }
}

async function importPokemonCardsImproved(limit: number = 10): Promise<void> {
  console.log(`🔥 Importing ${limit} Pokémon cards with improved handling...`)
  
  const pokemonAPI = new PokemonAPIService()
  
  try {
    // First, try to get available sets
    console.log('📋 Fetching Pokémon sets...')
    const sets = await pokemonAPI.getSets()
    
    if (sets.length === 0) {
      throw new Error('No Pokémon sets found')
    }
    
    console.log(`📦 Found ${sets.length} sets. Using: ${sets[0].name} (${sets[0].id})`)
    
    // Get Pokemon game ID
    const gameResult = await AppDataSource.query(`SELECT id FROM games WHERE code = 'POKEMON'`)
    if (gameResult.length === 0) {
      throw new Error('POKEMON game not found in database')
    }
    const gameId = gameResult[0].id

    // Try different sets until we find one with cards
    let cards: PokemonCard[] = []
    let selectedSet = null
    
    for (let i = 0; i < Math.min(sets.length, 5); i++) {
      try {
        console.log(`🔍 Trying set: ${sets[i].name} (${sets[i].id})`)
        const result = await pokemonAPI.getCards({
          setId: sets[i].id,
          pageSize: limit
        })
        
        if (result.data.length > 0) {
          cards = result.data
          selectedSet = sets[i]
          console.log(`✅ Found ${cards.length} cards in ${sets[i].name}`)
          break
        }
      } catch (error) {
        console.log(`⚠️  Failed to get cards from ${sets[i].name}, trying next set...`)
        continue
      }
    }
    
    if (cards.length === 0) {
      throw new Error('No cards found in any available sets')
    }

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
        
        // Rate limiting between cards
        await new Promise(resolve => setTimeout(resolve, 500))
        
      } catch (error) {
        console.error(`❌ Failed to import ${card.name}:`, error)
      }
    }
    
    console.log(`🔥 Pokémon Import complete: ${importedCount}/${limit} cards imported from ${selectedSet?.name}`)
    
  } catch (error) {
    console.error('❌ Pokémon import failed:', error)
    
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        console.log('💡 API timeout - the Pokémon TCG API may be experiencing high load')
      } else if (error.message.includes('API Error 401')) {
        console.log('💡 Check your POKEMON_TCG_API_KEY in .env file')
      } else if (error.message.includes('API Error 429')) {
        console.log('💡 Rate limited - try again later or reduce batch size')
      }
    }
  }
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Starting Improved Pokémon ETL')
    console.log('=====================================\n')

    await AppDataSource.initialize()
    console.log('🔌 Database connected')

    // Test with smaller batch first
    await importPokemonCardsImproved(5)

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

    console.log('\n🎉 Improved Pokémon ETL completed!')
    
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
#!/usr/bin/env npx ts-node

/**
 * Simple ETL script to import card data directly
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

interface ScryfallCard {
  id: string
  oracle_id: string
  name: string
  type_line: string
  oracle_text?: string
  flavor_text?: string
  mana_cost?: string
  cmc?: number
  colors?: string[]
  color_identity?: string[]
  power?: string
  toughness?: string
  set: string
  set_name: string
  collector_number: string
  rarity: string
  artist?: string
  image_uris?: {
    small?: string
    normal?: string
    large?: string
    art_crop?: string
  }
  prices?: {
    usd?: string
    usd_foil?: string
  }
  foil: boolean
  nonfoil: boolean
}

interface YugiohCard {
  id: number
  name: string
  type: string
  frameType: string
  desc: string
  atk?: number
  def?: number
  level?: number
  race: string
  attribute?: string
  archetype?: string
  card_sets?: Array<{
    set_name: string
    set_code: string
    set_rarity: string
    set_rarity_code: string
    set_price: string
  }>
  card_images?: Array<{
    id: number
    image_url: string
    image_url_small: string
    image_url_cropped: string
  }>
}

async function importMTGCards(limit: number = 20): Promise<void> {
  console.log(`🎴 Importing ${limit} Magic: The Gathering cards...`)
  
  try {
    const response = await axios.get('https://api.scryfall.com/cards/search', {
      params: {
        q: 'set:neo', // Kamigawa: Neon Dynasty
        page: 1,
        unique: 'cards'
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)'
      }
    })

    const cards = response.data.data.slice(0, limit) as ScryfallCard[]
    
    // Get MTG game ID
    const gameResult = await AppDataSource.query(`SELECT id FROM games WHERE code = 'MTG'`)
    if (gameResult.length === 0) {
      throw new Error('MTG game not found in database')
    }
    const gameId = gameResult[0].id

    let importedCount = 0
    
    for (const card of cards) {
      try {
        // Generate oracle hash (simple version)
        const oracleHash = `mtg_${card.oracle_id}`
        
        // Check if card already exists
        const existingCard = await AppDataSource.query(
          `SELECT id FROM cards WHERE oracle_id = $1`,
          [card.oracle_id]
        )
        
        if (existingCard.length > 0) {
          console.log(`⏭️  Skipping existing card: ${card.name}`)
          continue
        }

        // Insert card
        const cardResult = await AppDataSource.query(`
          INSERT INTO cards (
            game_id, oracle_id, name, normalized_name, primary_type, 
            oracle_text, flavor_text, mana_cost, mana_value, colors, 
            color_identity, power_value, defense_value, keywords
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
          RETURNING id
        `, [
          gameId,
          card.oracle_id,
          card.name,
          card.name.toLowerCase(),
          card.type_line.split(' ')[0], // First word as primary type
          card.oracle_text || null,
          card.flavor_text || null,
          card.mana_cost || null,
          card.cmc || null,
          card.colors || [],
          card.color_identity || [],
          card.power ? parseInt(card.power) : null,
          card.toughness ? parseInt(card.toughness) : null,
          []
        ])

        const cardId = cardResult[0].id

        // Create or get card set
        let setResult = await AppDataSource.query(
          `SELECT id FROM card_sets WHERE code = $1 AND game_id = $2`,
          [card.set, gameId]
        )

        if (setResult.length === 0) {
          setResult = await AppDataSource.query(`
            INSERT INTO card_sets (game_id, code, name, set_type, release_date, card_count)
            VALUES ($1, $2, $3, 'expansion', NOW(), 0)
            RETURNING id
          `, [gameId, card.set, card.set_name])
        }

        const setId = setResult[0].id

        // Insert print
        const printResult = await AppDataSource.query(`
          INSERT INTO prints (
            card_id, set_id, number, rarity, artist, language,
            image_small, image_normal, image_large, image_art_crop,
            blurhash, finish, frame, border_color, current_price_low
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING id
        `, [
          cardId,
          setId,
          card.collector_number,
          card.rarity,
          card.artist || 'Unknown',
          'en',
          card.image_uris?.small || '',
          card.image_uris?.normal || '',
          card.image_uris?.large || '',
          card.image_uris?.art_crop || null,
          'placeholder_blurhash',
          card.foil && card.nonfoil ? 'both' : card.foil ? 'foil' : 'normal',
          '2015',
          'black',
          card.prices?.usd ? parseFloat(card.prices.usd) : null
        ])

        const printId = printResult[0].id

        // Generate basic SKUs
        const conditions = ['NM', 'LP', 'MP']
        for (const condition of conditions) {
          const sku = `MTG-${card.set}-${card.collector_number}-EN-${condition}-NORMAL`
          
          await AppDataSource.query(`
            INSERT INTO catalog_skus (
              sku, print_id, game_code, set_code, card_number,
              language, condition, finish, is_available_b2c
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            sku, printId, 'MTG', card.set, card.collector_number,
            'EN', condition, 'NORMAL', false
          ])
        }

        importedCount++
        console.log(`✅ Imported: ${card.name} (${card.set_name})`)
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        console.error(`❌ Failed to import ${card.name}:`, error)
      }
    }
    
    console.log(`🎴 MTG Import complete: ${importedCount}/${limit} cards imported`)
    
  } catch (error) {
    console.error('❌ MTG import failed:', error)
  }
}

async function importYugiohCards(limit: number = 20): Promise<void> {
  console.log(`⚔️ Importing ${limit} Yu-Gi-Oh! cards...`)
  
  try {
    const response = await axios.get('https://db.ygoprodeck.com/api/v7/cardinfo.php', {
      params: {
        num: limit,
        offset: 0,
        sort: 'id'
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)'
      }
    })

    const cards = response.data.data as YugiohCard[]
    
    // Get Yugioh game ID
    const gameResult = await AppDataSource.query(`SELECT id FROM games WHERE code = 'YUGIOH'`)
    if (gameResult.length === 0) {
      throw new Error('YUGIOH game not found in database')
    }
    const gameId = gameResult[0].id

    let importedCount = 0
    
    for (const card of cards) {
      try {
        // Generate oracle ID
        const oracleId = `yugioh_${card.id}`
        
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
            oracle_text, attribute, level, attack_value, defense_value_yugioh
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
          RETURNING id
        `, [
          gameId,
          oracleId,
          card.name,
          card.name.toLowerCase(),
          card.type,
          card.desc,
          card.attribute || null,
          card.level || null,
          card.atk || null,
          card.def || null
        ])

        const cardId = cardResult[0].id

        // Handle sets
        if (card.card_sets && card.card_sets.length > 0) {
          const cardSet = card.card_sets[0] // Use first set
          
          let setResult = await AppDataSource.query(
            `SELECT id FROM card_sets WHERE code = $1 AND game_id = $2`,
            [cardSet.set_code, gameId]
          )

          if (setResult.length === 0) {
            setResult = await AppDataSource.query(`
              INSERT INTO card_sets (game_id, code, name, set_type, release_date, card_count)
              VALUES ($1, $2, $3, 'expansion', NOW(), 0)
              RETURNING id
            `, [gameId, cardSet.set_code, cardSet.set_name])
          }

          const setId = setResult[0].id

          // Use first image if available
          const image = card.card_images?.[0]
          
          // Insert print
          const printResult = await AppDataSource.query(`
            INSERT INTO prints (
              card_id, set_id, number, rarity, artist, language,
              image_small, image_normal, image_large, image_art_crop,
              blurhash, finish, frame, border_color
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id
          `, [
            cardId,
            setId,
            '001', // Default number
            cardSet.set_rarity || 'Common',
            'Konami',
            'en',
            image?.image_url_small || '',
            image?.image_url || '',
            image?.image_url || '',
            image?.image_url_cropped || null,
            'placeholder_blurhash',
            'normal',
            'normal',
            'black'
          ])

          const printId = printResult[0].id

          // Generate basic SKUs
          const conditions = ['NM', 'LP', 'MP']
          for (const condition of conditions) {
            const sku = `YUGIOH-${cardSet.set_code}-001-EN-${condition}-NORMAL`
            
            await AppDataSource.query(`
              INSERT INTO catalog_skus (
                sku, print_id, game_code, set_code, card_number,
                language, condition, finish, is_available_b2c
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
              sku, printId, 'YUGIOH', cardSet.set_code, '001',
              'EN', condition, 'NORMAL', false
            ])
          }
        }

        importedCount++
        console.log(`✅ Imported: ${card.name} (${card.type})`)
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        console.error(`❌ Failed to import ${card.name}:`, error)
      }
    }
    
    console.log(`⚔️ Yu-Gi-Oh! Import complete: ${importedCount}/${limit} cards imported`)
    
  } catch (error) {
    console.error('❌ Yu-Gi-Oh! import failed:', error)
  }
}

async function importPokemonCards(limit: number = 20): Promise<void> {
  console.log(`🔥 Importing ${limit} Pokémon cards...`)
  
  try {
    const response = await axios.get('https://api.pokemontcg.io/v2/cards', {
      params: {
        page: 1,
        pageSize: limit,
        q: 'set.id:swsh1' // Sword & Shield Base Set
      },
      timeout: 30000, // Increased timeout
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)',
        'X-Api-Key': process.env.POKEMON_TCG_API_KEY || ''
      }
    })

    const cards = response.data.data
    
    // Get Pokemon game ID
    const gameResult = await AppDataSource.query(`SELECT id FROM games WHERE code = 'POKEMON'`)
    if (gameResult.length === 0) {
      throw new Error('POKEMON game not found in database')
    }
    const gameId = gameResult[0].id

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
        console.log(`✅ Imported: ${card.name} (${card.set.name})`)
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200))
        
      } catch (error) {
        console.error(`❌ Failed to import ${card.name}:`, error)
      }
    }
    
    console.log(`🔥 Pokémon Import complete: ${importedCount}/${limit} cards imported`)
    
  } catch (error) {
    console.error('❌ Pokémon import failed:', error)
    if (error instanceof Error && 'code' in error && error.code === 'ECONNABORTED') {
      console.log('💡 Pokémon API timeout - try running with different API parameters or check API key')
    }
  }
}

async function importOnePieceCards(limit: number = 20): Promise<void> {
  console.log(`🏴‍☠️ Importing ${limit} One Piece cards...`)
  
  try {
    // Get cards from OP-01 set (Romance Dawn)
    const response = await axios.get('https://optcgapi.com/api/sets/OP-01/', {
      timeout: 10000,
      headers: {
        'User-Agent': 'SideDecked/1.0 (marketplace@sidedecked.com)'
      }
    })

    const cards = response.data.slice(0, limit)
    
    // Get One Piece game ID
    const gameResult = await AppDataSource.query(`SELECT id FROM games WHERE code = 'OPTCG'`)
    if (gameResult.length === 0) {
      throw new Error('OPTCG game not found in database')
    }
    const gameId = gameResult[0].id

    let importedCount = 0
    
    for (const card of cards) {
      try {
        // Generate oracle ID
        const oracleId = `onepiece_${card.card_set_id}`
        
        // Check if card already exists
        const existingCard = await AppDataSource.query(
          `SELECT id FROM cards WHERE oracle_id = $1`,
          [oracleId]
        )
        
        if (existingCard.length > 0) {
          console.log(`⏭️  Skipping existing card: ${card.card_name}`)
          continue
        }

        // Insert card
        const cardResult = await AppDataSource.query(`
          INSERT INTO cards (
            game_id, oracle_id, name, normalized_name, primary_type,
            oracle_text, cost, power, life, counter, attribute
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
          RETURNING id
        `, [
          gameId,
          oracleId,
          card.card_name,
          card.card_name.toLowerCase(),
          card.card_type,
          card.card_text || null,
          card.card_cost !== 'NULL' ? parseInt(card.card_cost) : null,
          card.card_power !== 'NULL' ? parseInt(card.card_power) : null,
          card.life !== 'NULL' ? parseInt(card.life) : null,
          card.counter_amount || null,
          card.attribute !== 'NULL' ? card.attribute : null
        ])

        const cardId = cardResult[0].id

        // Create or get card set
        let setResult = await AppDataSource.query(
          `SELECT id FROM card_sets WHERE code = $1 AND game_id = $2`,
          [card.set_id, gameId]
        )

        if (setResult.length === 0) {
          setResult = await AppDataSource.query(`
            INSERT INTO card_sets (game_id, code, name, set_type, release_date, card_count)
            VALUES ($1, $2, $3, 'expansion', '2022-07-22', 0)
            RETURNING id
          `, [gameId, card.set_id, card.set_name])
        }

        const setId = setResult[0].id

        // Insert print
        const printResult = await AppDataSource.query(`
          INSERT INTO prints (
            card_id, set_id, number, rarity, artist, language,
            image_small, image_normal, image_large,
            blurhash, finish, frame, border_color, current_price_low
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id
        `, [
          cardId,
          setId,
          card.card_set_id.split('-')[1] || '001', // Extract number from OP01-001
          card.rarity || 'Common',
          'Unknown',
          'en',
          card.card_image || '',
          card.card_image || '',
          card.card_image || '',
          'placeholder_blurhash',
          'normal',
          'normal',
          card.card_color.toLowerCase() || 'black',
          card.market_price ? parseFloat(card.market_price) : null
        ])

        const printId = printResult[0].id

        // Generate basic SKUs
        const conditions = ['NM', 'LP', 'MP']
        for (const condition of conditions) {
          const sku = `OPTCG-${card.set_id}-${card.card_set_id.split('-')[1]}-EN-${condition}-NORMAL`
          
          await AppDataSource.query(`
            INSERT INTO catalog_skus (
              sku, print_id, game_code, set_code, card_number,
              language, condition, finish, is_available_b2c, market_price
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `, [
            sku, printId, 'OPTCG', card.set_id, card.card_set_id.split('-')[1],
            'EN', condition, 'NORMAL', false, card.market_price ? parseFloat(card.market_price) : null
          ])
        }

        importedCount++
        console.log(`✅ Imported: ${card.card_name} (${card.rarity} - ${card.card_color})`)
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))
        
      } catch (error) {
        console.error(`❌ Failed to import ${card.card_name}:`, error)
      }
    }
    
    console.log(`🏴‍☠️ One Piece Import complete: ${importedCount}/${limit} cards imported`)
    
  } catch (error) {
    console.error('❌ One Piece import failed:', error)
  }
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Starting Simple ETL Process')
    console.log('===============================\n')

    await AppDataSource.initialize()
    console.log('🔌 Database connected')

    // Import small batches from working APIs
    await importMTGCards(10)
    console.log('')
    await importYugiohCards(10)
    console.log('')
    await importPokemonCards(10)
    console.log('')
    await importOnePieceCards(10)

    console.log('\n📊 ETL Summary')
    console.log('===============')
    
    // Check final counts
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
      GROUP BY g.code, g.name
      ORDER BY g.code
    `)
    
    counts.forEach((count: any) => {
      console.log(`${count.game}: ${count.cards} cards, ${count.prints} prints, ${count.skus} SKUs`)
    })

    console.log('\n🎉 ETL completed successfully!')
    
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
#!/usr/bin/env npx ts-node

/**
 * Fallback Pokémon ETL using sample data when API is unavailable
 */

import 'reflect-metadata'
import { DataSource } from 'typeorm'
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

// Sample Pokémon data for fallback testing
const SAMPLE_POKEMON_CARDS = [
  {
    id: 'base1-1',
    name: 'Alakazam',
    hp: '80',
    types: ['Psychic'],
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    number: '1',
    artist: 'Ken Sugimori',
    rarity: 'Rare Holo',
    set: {
      id: 'base1',
      name: 'Base',
      releaseDate: '1999/01/09',
      total: 102
    },
    images: {
      small: 'https://images.pokemontcg.io/base1/1.png',
      normal: 'https://images.pokemontcg.io/base1/1_hires.png',
      large: 'https://images.pokemontcg.io/base1/1_hires.png'
    }
  },
  {
    id: 'base1-2',
    name: 'Blastoise',
    hp: '100',
    types: ['Water'],
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    number: '2',
    artist: 'Ken Sugimori',
    rarity: 'Rare Holo',
    set: {
      id: 'base1',
      name: 'Base',
      releaseDate: '1999/01/09',
      total: 102
    },
    images: {
      small: 'https://images.pokemontcg.io/base1/2.png',
      normal: 'https://images.pokemontcg.io/base1/2_hires.png',
      large: 'https://images.pokemontcg.io/base1/2_hires.png'
    }
  },
  {
    id: 'base1-3',
    name: 'Chansey',
    hp: '120',
    types: ['Colorless'],
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    number: '3',
    artist: 'Ken Sugimori',
    rarity: 'Rare Holo',
    set: {
      id: 'base1',
      name: 'Base',
      releaseDate: '1999/01/09',
      total: 102
    },
    images: {
      small: 'https://images.pokemontcg.io/base1/3.png',
      normal: 'https://images.pokemontcg.io/base1/3_hires.png',
      large: 'https://images.pokemontcg.io/base1/3_hires.png'
    }
  },
  {
    id: 'base1-4',
    name: 'Charizard',
    hp: '120',
    types: ['Fire'],
    supertype: 'Pokémon',
    subtypes: ['Stage 2'],
    number: '4',
    artist: 'Mitsuhiro Arita',
    rarity: 'Rare Holo',
    set: {
      id: 'base1',
      name: 'Base',
      releaseDate: '1999/01/09',
      total: 102
    },
    images: {
      small: 'https://images.pokemontcg.io/base1/4.png',
      normal: 'https://images.pokemontcg.io/base1/4_hires.png',
      large: 'https://images.pokemontcg.io/base1/4_hires.png'
    }
  },
  {
    id: 'base1-5',
    name: 'Clefairy',
    hp: '40',
    types: ['Colorless'],
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    number: '5',
    artist: 'Ken Sugimori',
    rarity: 'Rare Holo',
    set: {
      id: 'base1',
      name: 'Base',
      releaseDate: '1999/01/09',
      total: 102
    },
    images: {
      small: 'https://images.pokemontcg.io/base1/5.png',
      normal: 'https://images.pokemontcg.io/base1/5_hires.png',
      large: 'https://images.pokemontcg.io/base1/5_hires.png'
    }
  }
]

async function importPokemonCardsFallback(limit: number = 5): Promise<void> {
  console.log(`🔥 Importing ${limit} Pokémon cards using fallback data...`)
  console.log('⚠️  Note: Using sample data because Pokémon TCG API is unavailable')
  
  try {
    // Get Pokemon game ID
    const gameResult = await AppDataSource.query(`SELECT id FROM games WHERE code = 'POKEMON'`)
    if (gameResult.length === 0) {
      throw new Error('POKEMON game not found in database')
    }
    const gameId = gameResult[0].id

    const cards = SAMPLE_POKEMON_CARDS.slice(0, limit)
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
            hp, energy_types
          ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
          RETURNING id
        `, [
          gameId,
          oracleId,
          card.name,
          card.name.toLowerCase(),
          card.supertype || card.subtypes?.[0] || 'Unknown',
          card.hp ? parseInt(card.hp) : null,
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
        
      } catch (error) {
        console.error(`❌ Failed to import ${card.name}:`, error)
      }
    }
    
    console.log(`🔥 Pokémon Fallback Import complete: ${importedCount}/${limit} cards imported`)
    
  } catch (error) {
    console.error('❌ Pokémon fallback import failed:', error)
  }
}

async function main(): Promise<void> {
  try {
    console.log('🚀 Starting Pokémon Fallback ETL')
    console.log('==================================\n')

    await AppDataSource.initialize()
    console.log('🔌 Database connected')

    await importPokemonCardsFallback(5)

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

    console.log('\n✅ Pokémon fallback ETL completed successfully!')
    console.log('💡 Note: To use live API data, ensure network connectivity to api.pokemontcg.io')
    
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
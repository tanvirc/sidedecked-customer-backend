import { AppDataSource } from '../config/database'
import { Format } from '../entities/Format'
import { Game } from '../entities/Game'

interface FormatData {
  code: string
  name: string
  gameCode: string
  formatType: 'constructed' | 'limited' | 'eternal' | 'casual'
  isRotating: boolean
  rotationSchedule?: string | null
  minDeckSize: number
  maxDeckSize?: number | null
  maxCopiesPerCard: number
  allowsSideboard: boolean
  maxSideboardSize: number
  bannedCardTypes?: string[]
  requiredCardTypes?: string[]
  specialRules?: any
  
  // Game-specific fields
  leaderRequired?: boolean
  leaderZoneSize?: number
  donDeckSize?: number
  prizeCardCount?: number
  regulationMarks?: string[]
  restrictedCards?: string[]
  extraDeckRequired?: boolean
  maxExtraDeckSize?: number
  isSingleton?: boolean
  typeRestricted?: boolean
  rarityRestrictions?: string[]
}

// Official format definitions based on comprehensive research
const OFFICIAL_FORMATS: FormatData[] = [
  // MAGIC: THE GATHERING (MTG) - Official Wizards of the Coast formats
  {
    code: 'standard',
    name: 'Standard',
    gameCode: 'MTG',
    formatType: 'constructed',
    isRotating: true,
    rotationSchedule: 'annual',
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    allowsSideboard: true,
    maxSideboardSize: 15,
    specialRules: {
      description: 'Uses cards from the most recent Standard-legal sets',
      bannedCards: [],
      rotationInfo: 'Rotates annually with new set releases'
    }
  },
  {
    code: 'pioneer',
    name: 'Pioneer',
    gameCode: 'MTG',
    formatType: 'constructed',
    isRotating: false,
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    allowsSideboard: true,
    maxSideboardSize: 15,
    specialRules: {
      description: 'Non-rotating format using cards from Return to Ravnica forward',
      legalSets: 'Return to Ravnica block and all subsequent sets',
      bannedCards: []
    }
  },
  {
    code: 'modern',
    name: 'Modern',
    gameCode: 'MTG',
    formatType: 'constructed',
    isRotating: false,
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    allowsSideboard: true,
    maxSideboardSize: 15,
    specialRules: {
      description: 'Non-rotating format using cards from 8th Edition core set forward',
      legalSets: '8th Edition and all subsequent core sets and expansions',
      bannedCards: []
    }
  },
  {
    code: 'legacy',
    name: 'Legacy',
    gameCode: 'MTG',
    formatType: 'eternal',
    isRotating: false,
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    allowsSideboard: true,
    maxSideboardSize: 15,
    specialRules: {
      description: 'Eternal format allowing cards from all Magic sets with a banned list',
      legalSets: 'All Magic sets',
      bannedCards: []
    }
  },
  {
    code: 'vintage',
    name: 'Vintage',
    gameCode: 'MTG',
    formatType: 'eternal',
    isRotating: false,
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    allowsSideboard: true,
    maxSideboardSize: 15,
    restrictedCards: [], // Vintage uses restricted list instead of banned
    specialRules: {
      description: 'Most powerful format with minimal restrictions using restricted list',
      legalSets: 'All Magic sets including Power Nine',
      restrictedInfo: 'Uses restricted list (limit 1) instead of banned list'
    }
  },
  {
    code: 'commander',
    name: 'Commander',
    gameCode: 'MTG',
    formatType: 'casual',
    isRotating: false,
    minDeckSize: 100,
    maxDeckSize: 100,
    maxCopiesPerCard: 1,
    allowsSideboard: false,
    maxSideboardSize: 0,
    requiredCardTypes: ['Legendary Creature'],
    isSingleton: true,
    specialRules: {
      description: '100-card singleton format with legendary commander',
      commanderRequired: true,
      multiplayer: true,
      startingLifeTotal: 40
    }
  },
  {
    code: 'pauper',
    name: 'Pauper',
    gameCode: 'MTG',
    formatType: 'constructed',
    isRotating: false,
    minDeckSize: 60,
    maxDeckSize: null,
    maxCopiesPerCard: 4,
    allowsSideboard: true,
    maxSideboardSize: 15,
    rarityRestrictions: ['common'],
    specialRules: {
      description: 'Format allowing only common rarity cards',
      rarityRestriction: 'Common cards only'
    }
  },
  {
    code: 'limited',
    name: 'Limited',
    gameCode: 'MTG',
    formatType: 'limited',
    isRotating: false,
    minDeckSize: 40,
    maxDeckSize: null,
    maxCopiesPerCard: 999, // No limit in limited
    allowsSideboard: true,
    maxSideboardSize: 999, // Unused cards become sideboard
    specialRules: {
      description: 'Draft and Sealed formats where players build decks from limited card pools',
      variants: ['Draft', 'Sealed']
    }
  },

  // POKÉMON TCG - Official Pokémon Company formats
  {
    code: 'standard',
    name: 'Standard',
    gameCode: 'POKEMON',
    formatType: 'constructed',
    isRotating: true,
    rotationSchedule: 'annual',
    minDeckSize: 60,
    maxDeckSize: 60,
    maxCopiesPerCard: 4,
    allowsSideboard: false,
    maxSideboardSize: 0,
    prizeCardCount: 6,
    regulationMarks: ['G', 'H'], // Current 2025 regulation marks
    specialRules: {
      description: 'Current Standard format using regulation marks G and H',
      prizeCards: 6,
      regulationMarks: 'G and H marks currently legal',
      rotationInfo: 'Rotates annually based on regulation marks'
    }
  },
  {
    code: 'expanded',
    name: 'Expanded',
    gameCode: 'POKEMON',
    formatType: 'constructed',
    isRotating: false,
    minDeckSize: 60,
    maxDeckSize: 60,
    maxCopiesPerCard: 4,
    allowsSideboard: false,
    maxSideboardSize: 0,
    prizeCardCount: 6,
    specialRules: {
      description: 'Non-rotating format using cards from Black & White base set onward',
      legalSets: 'Black & White base set and all subsequent sets',
      prizeCards: 6,
      bannedCards: []
    }
  },
  {
    code: 'unlimited',
    name: 'Unlimited',
    gameCode: 'POKEMON',
    formatType: 'casual',
    isRotating: false,
    minDeckSize: 60,
    maxDeckSize: 60,
    maxCopiesPerCard: 4,
    allowsSideboard: false,
    maxSideboardSize: 0,
    prizeCardCount: 6,
    specialRules: {
      description: 'Casual format allowing all Pokémon TCG cards ever printed',
      legalSets: 'All Pokémon TCG sets',
      prizeCards: 6
    }
  },
  {
    code: 'glc',
    name: 'Gym Leader Challenge',
    gameCode: 'POKEMON',
    formatType: 'casual',
    isRotating: false,
    minDeckSize: 60,
    maxDeckSize: 60,
    maxCopiesPerCard: 1,
    allowsSideboard: false,
    maxSideboardSize: 0,
    prizeCardCount: 6,
    isSingleton: true,
    typeRestricted: true,
    bannedCardTypes: ['Rule Box Pokémon', 'Pokémon ex', 'Pokémon V', 'Pokémon-GX', 'Pokémon-EX'],
    specialRules: {
      description: 'Singleton format where all Pokémon must share a single type',
      typeRestriction: 'All Pokémon must share one type',
      singleton: true,
      prizeCards: 6,
      bannedCards: 'All Rule Box Pokémon prohibited'
    }
  },

  // YU-GI-OH! - Official Konami formats
  {
    code: 'advanced',
    name: 'Advanced',
    gameCode: 'YUGIOH',
    formatType: 'constructed',
    isRotating: false,
    minDeckSize: 40,
    maxDeckSize: 60,
    maxCopiesPerCard: 3,
    allowsSideboard: true,
    maxSideboardSize: 15,
    extraDeckRequired: false,
    maxExtraDeckSize: 15,
    specialRules: {
      description: 'Primary competitive format with Forbidden & Limited List',
      extraDeck: 'Up to 15 cards (Fusion, Synchro, Xyz, Pendulum, Link)',
      bannedList: 'Uses Forbidden & Limited List',
      startingLifePoints: 8000
    }
  },
  {
    code: 'traditional',
    name: 'Traditional',
    gameCode: 'YUGIOH',
    formatType: 'casual',
    isRotating: false,
    minDeckSize: 40,
    maxDeckSize: 60,
    maxCopiesPerCard: 3,
    allowsSideboard: true,
    maxSideboardSize: 15,
    extraDeckRequired: false,
    maxExtraDeckSize: 15,
    specialRules: {
      description: 'Format with no Forbidden cards, only Limited and Semi-Limited',
      extraDeck: 'Up to 15 cards (Fusion, Synchro, Xyz, Pendulum, Link)',
      bannedList: 'No Forbidden cards, all moved to Limited',
      startingLifePoints: 8000
    }
  },
  {
    code: 'rush',
    name: 'Rush Duel',
    gameCode: 'YUGIOH',
    formatType: 'casual',
    isRotating: false,
    minDeckSize: 40,
    maxDeckSize: 60,
    maxCopiesPerCard: 3,
    allowsSideboard: true,
    maxSideboardSize: 15,
    extraDeckRequired: false,
    maxExtraDeckSize: 15,
    specialRules: {
      description: 'Simplified format with unique rules and card pool',
      extraDeck: 'Up to 15 cards',
      gameplayRules: 'Draw until 5 cards, multiple Normal Summons per turn',
      startingLifePoints: 8000,
      legendCards: 'Maximum 1 Legend Card of each type'
    }
  },

  // ONE PIECE TCG - Official Bandai formats
  {
    code: 'standard',
    name: 'Standard',
    gameCode: 'OPTCG',
    formatType: 'constructed',
    isRotating: true,
    rotationSchedule: 'annual',
    minDeckSize: 50,
    maxDeckSize: 50,
    maxCopiesPerCard: 4,
    allowsSideboard: false,
    maxSideboardSize: 0,
    leaderRequired: true,
    leaderZoneSize: 1,
    donDeckSize: 10,
    specialRules: {
      description: 'Standard format with leader card and DON!! deck system',
      leaderCard: 'Required leader card defines deck color',
      donDeck: '10 DON!! cards for resource management',
      colorRestriction: 'Deck cards must match leader color',
      blockRotation: 'Annual block rotation starting April 2026'
    }
  }
]

export async function seedFormats(): Promise<void> {
  console.log('🌱 Starting format seeding...')
  
  try {
    await AppDataSource.initialize()
    console.log('✅ Database connected')

    const gameRepository = AppDataSource.getRepository(Game)
    const formatRepository = AppDataSource.getRepository(Format)

    // Clear existing formats
    console.log('🧹 Clearing existing formats...')
    await formatRepository.query('DELETE FROM formats')

    let totalCreated = 0

    for (const formatData of OFFICIAL_FORMATS) {
      // Find the game
      const game = await gameRepository.findOne({ 
        where: { code: formatData.gameCode } 
      })

      if (!game) {
        console.warn(`⚠️ Game ${formatData.gameCode} not found, skipping format ${formatData.name}`)
        continue
      }

      // Create format
      const format = formatRepository.create()
      
      // Set basic properties
      format.gameId = game.id
      format.code = formatData.code
      format.name = formatData.name
      format.formatType = formatData.formatType
      format.isRotating = formatData.isRotating
      if (formatData.rotationSchedule) {
        format.rotationSchedule = formatData.rotationSchedule
      }
      format.minDeckSize = formatData.minDeckSize
      if (formatData.maxDeckSize) {
        format.maxDeckSize = formatData.maxDeckSize
      }
      format.maxCopiesPerCard = formatData.maxCopiesPerCard
      format.allowsSideboard = formatData.allowsSideboard
      format.maxSideboardSize = formatData.maxSideboardSize
      format.bannedCardTypes = formatData.bannedCardTypes || []
      format.requiredCardTypes = formatData.requiredCardTypes || []
      format.specialRules = formatData.specialRules || {}
      
      // Game-specific fields
      format.leaderRequired = formatData.leaderRequired || false
      format.leaderZoneSize = formatData.leaderZoneSize || 0
      format.donDeckSize = formatData.donDeckSize || 0
      format.prizeCardCount = formatData.prizeCardCount || 0
      format.regulationMarks = formatData.regulationMarks || []
      format.restrictedCards = formatData.restrictedCards || []
      format.extraDeckRequired = formatData.extraDeckRequired || false
      format.maxExtraDeckSize = formatData.maxExtraDeckSize || 0
      format.isSingleton = formatData.isSingleton || false
      format.typeRestricted = formatData.typeRestricted || false
      format.rarityRestrictions = formatData.rarityRestrictions || []
      format.isActive = true

      await formatRepository.save(format)
      console.log(`✅ Created ${formatData.gameCode} format: ${formatData.name}`)
      totalCreated++
    }

    console.log(`🎉 Successfully seeded ${totalCreated} official formats!`)
    
    // Display summary by game
    const games = await gameRepository.find({ relations: ['formats'] })
    console.log('\n📊 Format Summary by Game:')
    for (const game of games) {
      const activeFormats = game.formats?.filter(f => f.isActive) || []
      console.log(`  ${game.displayName} (${game.code}): ${activeFormats.length} formats`)
      activeFormats.forEach(format => {
        console.log(`    - ${format.name} (${format.code})`)
      })
    }

    await AppDataSource.destroy()
    console.log('✅ Database connection closed')

  } catch (error) {
    console.error('❌ Error seeding formats:', error)
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack)
    }
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  seedFormats()
    .then(() => {
      console.log('🎯 Format seeding completed successfully!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('💥 Format seeding failed:', error)
      process.exit(1)
    })
}
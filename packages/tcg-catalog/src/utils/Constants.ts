export const GAME_CODES = {
  MTG: 'MTG',
  POKEMON: 'POKEMON', 
  YUGIOH: 'YUGIOH',
  OPTCG: 'OPTCG'
} as const

export const CONDITION_CODES = {
  NEAR_MINT: 'NM',
  LIGHTLY_PLAYED: 'LP', 
  MODERATELY_PLAYED: 'MP',
  HEAVILY_PLAYED: 'HP',
  DAMAGED: 'DMG'
} as const

export const FINISH_CODES = {
  NORMAL: 'NORMAL',
  FOIL: 'FOIL',
  REVERSE: 'REVERSE',
  FIRST_EDITION: '1ST',
  UNLIMITED: 'UNLTD',
  ETCHED: 'ETCHED'
} as const

export const LANGUAGE_CODES = {
  ENGLISH: 'EN',
  JAPANESE: 'JP',
  GERMAN: 'DE',
  FRENCH: 'FR',
  SPANISH: 'ES',
  ITALIAN: 'IT',
  PORTUGUESE: 'PT',
  RUSSIAN: 'RU',
  KOREAN: 'KO',
  CHINESE_SIMPLIFIED: 'ZHS',
  CHINESE_TRADITIONAL: 'ZHT'
} as const

export const GRADING_COMPANIES = {
  PSA: 'PSA',
  BGS: 'BGS',
  CGC: 'CGC',
  SGC: 'SGC'
} as const

export const MTG_COLORS = ['W', 'U', 'B', 'R', 'G'] as const
export const MTG_COLOR_NAMES = {
  W: 'White',
  U: 'Blue', 
  B: 'Black',
  R: 'Red',
  G: 'Green'
} as const

export const POKEMON_ENERGY_TYPES = [
  'Grass', 'Fire', 'Water', 'Lightning', 'Psychic',
  'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon', 'Colorless'
] as const

export const YUGIOH_ATTRIBUTES = [
  'DARK', 'LIGHT', 'WATER', 'FIRE', 'EARTH', 'WIND', 'DIVINE'
] as const

export const ONEPIECE_COLORS = [
  'Red', 'Green', 'Blue', 'Purple', 'Yellow', 'Black'
] as const

export const RARITY_HIERARCHY = {
  MTG: ['common', 'uncommon', 'rare', 'mythic'],
  POKEMON: ['common', 'uncommon', 'rare', 'rare_holo', 'rare_ultra', 'rare_secret'],
  YUGIOH: ['common', 'rare', 'super_rare', 'ultra_rare', 'secret_rare'],
  OPTCG: ['common', 'uncommon', 'rare', 'super_rare', 'secret_rare', 'leader']
} as const

export const IMAGE_SIZES = {
  THUMBNAIL: { width: 146, height: 204 },
  SMALL: { width: 244, height: 340 },
  NORMAL: { width: 488, height: 680 },
  LARGE: { width: 745, height: 1040 }
} as const

export const IMAGE_QUALITY = {
  THUMBNAIL: 75,
  SMALL: 80,
  NORMAL: 85,
  LARGE: 90,
  ORIGINAL: 95
} as const

export const ETL_CONFIG = {
  DEFAULT_BATCH_SIZE: 100,
  DEFAULT_RATE_LIMIT_DELAY: 1000,
  DEFAULT_CONCURRENCY: 2,
  MAX_RETRIES: 5,
  CIRCUIT_BREAKER_THRESHOLD: 10,
  CIRCUIT_BREAKER_RESET_TIMEOUT: 60000,
  CHECKPOINT_INTERVAL: 100
} as const

export const API_ENDPOINTS = {
  SCRYFALL: {
    BASE_URL: 'https://api.scryfall.com',
    CARDS: '/cards',
    SETS: '/sets',
    BULK_DATA: '/bulk-data'
  },
  POKEMON_TCG: {
    BASE_URL: 'https://api.pokemontcg.io/v2',
    CARDS: '/cards',
    SETS: '/sets'
  },
  YGOPRODECK: {
    BASE_URL: 'https://db.ygoprodeck.com/api/v7',
    CARDINFO: '/cardinfo.php',
    SETS: '/cardsets.php'
  },
  ONEPIECE_TCG: {
    BASE_URL: 'https://onepiece-cardgame.dev/api',
    CARDS: '/cards',
    SETS: '/sets'
  }
} as const

export const CACHE_KEYS = {
  CARD: (id: string) => `card:${id}`,
  PRINT: (id: string) => `print:${id}`,
  SKU: (sku: string) => `sku:${sku}`,
  SET: (gameCode: string, setCode: string) => `set:${gameCode}:${setCode}`,
  SEARCH: (query: string) => `search:${Buffer.from(query).toString('base64')}`,
  PRICE: (skuId: string) => `price:${skuId}`,
  IMAGE: (printId: string, type: string) => `image:${printId}:${type}`
} as const

export const CACHE_TTL = {
  SHORT: 300, // 5 minutes
  MEDIUM: 3600, // 1 hour  
  LONG: 86400, // 24 hours
  PERMANENT: 2592000 // 30 days
} as const

export const QUEUE_NAMES = {
  ETL: 'etl-jobs',
  IMAGE_PROCESSING: 'image-processing',
  PRICE_UPDATE: 'price-update',
  SEARCH_INDEX: 'search-index'
} as const

export const QUEUE_PRIORITIES = {
  CRITICAL: 10,
  HIGH: 7,
  NORMAL: 5,
  LOW: 2,
  BACKGROUND: 1
} as const

export const SKU_SEPARATOR = '-' as const

export const DEFAULT_SEARCH_LIMIT = 24 as const
export const MAX_SEARCH_LIMIT = 100 as const

export const PRICE_TREND_THRESHOLDS = {
  SIGNIFICANT_CHANGE: 0.1, // 10%
  MAJOR_CHANGE: 0.25, // 25%
  EXTREME_CHANGE: 0.5 // 50%
} as const

export const SUPPORTED_IMAGE_FORMATS = [
  'image/jpeg',
  'image/png', 
  'image/webp',
  'image/gif'
] as const

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
export const MIN_IMAGE_DIMENSIONS = { width: 100, height: 100 }
export const MAX_IMAGE_DIMENSIONS = { width: 3000, height: 4000 }
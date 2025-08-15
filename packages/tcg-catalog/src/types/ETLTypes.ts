export interface ETLConfig {
  batchSize: number
  rateLimitDelay: number
  concurrency: number
  skipImages: boolean
  forceUpdate: boolean
  maxRetries: number
  circuitBreakerThreshold: number
  circuitBreakerResetTimeout: number
}

export interface ETLResult {
  success: boolean
  gameCode: string
  totalProcessed: number
  cardsCreated: number
  cardsUpdated: number
  cardsDeleted: number
  printsCreated: number
  printsUpdated: number
  imagesQueued: number
  skusGenerated: number
  duration: number
  errors: ETLError[]
}

export interface ETLError {
  type: 'api_error' | 'validation_error' | 'database_error' | 'image_error'
  message: string
  details?: any
  timestamp: Date
  retryable: boolean
}

export interface UniversalCard {
  // Universal attributes
  oracleId: string
  oracleHash?: string
  name: string
  normalizedName: string
  primaryType: string
  subtypes?: string[]
  supertypes?: string[]
  powerValue?: number
  defenseValue?: number
  oracleText?: string
  flavorText?: string
  keywords?: string[]

  // Game-specific attributes
  manaCost?: string
  manaValue?: number
  colors?: string[]
  colorIdentity?: string[]
  hp?: number
  retreatCost?: number
  energyTypes?: string[]
  evolutionStage?: string
  attribute?: string
  levelRank?: number
  linkValue?: number
  linkArrows?: string[]
  pendulumScale?: number
  attackValue?: number
  defenseValueYugioh?: number
  cost?: number
  donCost?: number
  lifeValue?: number
  counterValue?: number
  power?: number

  // Extended attributes
  extendedAttributes?: Record<string, any>
  
  // Prints
  prints: UniversalPrint[]
}

export interface UniversalPrint {
  setCode: string
  setName: string
  collectorNumber: string
  rarity: string
  artist?: string
  flavorText?: string
  language: string
  printHash?: string
  
  // Print features
  isFoilAvailable: boolean
  isAlternateArt: boolean
  isPromo: boolean
  isFirstEdition?: boolean
  finish: string
  variation?: string
  frame?: string
  borderColor?: string

  // Images
  images?: {
    small?: string
    normal?: string
    large?: string
    artCrop?: string
    borderCrop?: string
  }

  // Pricing
  prices?: {
    usd?: number
    usdFoil?: number
    eur?: number
    tix?: number
  }

  // External IDs
  externalIds?: {
    scryfall?: string
    tcgplayer?: string
    cardmarket?: string
    pokemonTcg?: string
    yugiohProdeck?: string
  }
}

export interface DataSourceConfig {
  provider: string
  baseUrl: string
  apiKey?: string
  rateLimit: number
  timeout: number
  retryConfig: {
    maxRetries: number
    backoffMs: number
    backoffMultiplier: number
  }
  endpoints: Record<string, string>
}

export interface ImportCheckpoint {
  lastProcessedId?: string
  lastProcessedPage?: number
  lastProcessedTimestamp?: Date
  state?: Record<string, any>
}

export interface CircuitBreakerState {
  isOpen: boolean
  failureCount: number
  lastFailureTime?: Date
  resetTimeout: number
}
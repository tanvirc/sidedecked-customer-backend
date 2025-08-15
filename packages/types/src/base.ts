/**
 * Base entity interface with audit fields
 */
export interface BaseEntity {
  id: string
  created_at: Date
  updated_at: Date
  deleted_at?: Date | null
}

/**
 * Universal SKU format for TCG products
 * Format: {GAME}-{SET}-{NUMBER}-{LANG}-{CONDITION}-{FINISH}[-{GRADE}]
 */
export interface UniversalSKU {
  gameCode: string          // MTG, POKEMON, YUGIOH, OPTCG
  setCode: string          // Set abbreviation
  number: string           // Card number in set
  language: string         // EN, JA, etc.
  condition: string        // NM, LP, MP, HP, DMG
  finish: string           // NORMAL, FOIL, ETCHED, etc.
  grade?: string          // PSA10, BGS9.5, etc. (if graded)
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page?: number
  limit?: number
  offset?: number
}

/**
 * Sort parameters
 */
export interface SortParams {
  field: string
  direction: 'asc' | 'desc'
}

/**
 * API Response wrapper
 */
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  message?: string
  error?: string
  pagination?: {
    page: number
    limit: number
    total: number
    hasMore: boolean
  }
}
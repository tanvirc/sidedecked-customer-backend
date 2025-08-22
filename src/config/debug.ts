import { config } from './env'

export type DebugCategory = 
  | 'console'      // Console debug statements
  | 'logger'       // Logger debug calls
  | 'startup'      // Server startup debug checks
  | 'scripts'      // Debug scripts execution
  | 'performance'  // Performance debugging
  | 'queue'        // Queue/job debugging
  | 'api'          // API request/response debugging
  | 'database'     // Database query debugging

export interface DebugConfig {
  enabled: boolean
  categories: Set<DebugCategory>
  railwayOnly: boolean
  isRailwayEnvironment: boolean
}

class DebugController {
  private config: DebugConfig

  constructor() {
    // Detect Railway environment
    const isRailwayEnvironment = !!(
      process.env.RAILWAY_ENVIRONMENT || 
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID
    )

    // Parse debug categories from environment
    const categoriesStr = process.env.DEBUG_CATEGORIES || ''
    const categories = new Set<DebugCategory>(
      categoriesStr
        .split(',')
        .map(cat => cat.trim())
        .filter(cat => cat.length > 0) as DebugCategory[]
    )

    // Master debug enabled flag
    const debugEnabled = process.env.DEBUG_ENABLED === 'true'
    
    // Railway-only restriction
    const railwayOnly = process.env.DEBUG_RAILWAY_ONLY === 'true'

    this.config = {
      enabled: debugEnabled,
      categories,
      railwayOnly,
      isRailwayEnvironment
    }

    // Log debug configuration on startup (only if debug is enabled)
    if (this.shouldDebug('startup')) {
      console.log('🐛 Debug configuration initialized:', {
        enabled: this.config.enabled,
        categories: Array.from(this.config.categories),
        railwayOnly: this.config.railwayOnly,
        isRailwayEnvironment: this.config.isRailwayEnvironment,
        environment: config.NODE_ENV
      })
    }
  }

  /**
   * Check if debugging is enabled for a specific category
   */
  shouldDebug(category: DebugCategory): boolean {
    // If debugging is completely disabled, return false
    if (!this.config.enabled) {
      return false
    }

    // If Railway-only mode is enabled and we're not on Railway, return false
    if (this.config.railwayOnly && !this.config.isRailwayEnvironment) {
      return false
    }

    // If no categories are specified, enable all categories
    if (this.config.categories.size === 0) {
      return true
    }

    // Check if the specific category is enabled
    return this.config.categories.has(category)
  }

  /**
   * Get debug configuration for inspection
   */
  getConfig(): Readonly<DebugConfig> {
    return {
      ...this.config,
      categories: new Set(this.config.categories) // Return a copy
    }
  }

  /**
   * Check if any debugging is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && 
           (!this.config.railwayOnly || this.config.isRailwayEnvironment)
  }

  /**
   * Get enabled categories as array
   */
  getEnabledCategories(): DebugCategory[] {
    if (!this.isEnabled()) {
      return []
    }
    
    if (this.config.categories.size === 0) {
      return ['console', 'logger', 'startup', 'scripts', 'performance', 'queue', 'api', 'database']
    }
    
    return Array.from(this.config.categories)
  }
}

// Create singleton instance
export const debugController = new DebugController()

// Convenience functions for common debug checks
export const isDebugEnabled = () => debugController.isEnabled()
export const shouldDebug = (category: DebugCategory) => debugController.shouldDebug(category)
export const getDebugConfig = () => debugController.getConfig()
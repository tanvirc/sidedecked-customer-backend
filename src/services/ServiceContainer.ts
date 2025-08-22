import { InventorySyncService } from './InventorySyncService'
import { logger } from '../config/logger'
import { debugInfo } from '../utils/debug'

/**
 * Simple service container for dependency injection and service management
 * Provides singleton instances of core services throughout the application
 */
export class ServiceContainer {
  private static instance: ServiceContainer
  private services: Map<string, any> = new Map()

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance of the service container
   */
  static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer()
    }
    return ServiceContainer.instance
  }

  /**
   * Initialize all services
   * Call this during application startup
   */
  async initializeServices(): Promise<void> {
    logger.info('Initializing services...')

    try {
      // Initialize InventorySyncService
      const inventorySyncService = new InventorySyncService()
      this.services.set('inventorySyncService', inventorySyncService)
      
      // Perform health check to ensure service is working
      const health = await inventorySyncService.healthCheck()
      if (!health.healthy) {
        logger.warn('InventorySyncService health check failed', health)
      } else {
        logger.info('InventorySyncService initialized successfully')
      }

      // TODO: Initialize other services as they are created
      // const deckBuilderService = new DeckBuilderService()
      // this.services.set('deckBuilderService', deckBuilderService)
      
      // const communityService = new CommunityService()
      // this.services.set('communityService', communityService)
      
      // const pricingService = new PricingService()
      // this.services.set('pricingService', pricingService)

      logger.info('All services initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize services', error as Error)
      throw error
    }
  }

  /**
   * Get a service instance by name
   */
  getService<T>(name: string): T {
    const service = this.services.get(name)
    if (!service) {
      throw new Error(`Service '${name}' not found. Make sure it's registered in the container.`)
    }
    return service as T
  }

  /**
   * Register a service instance
   */
  registerService(name: string, service: any): void {
    this.services.set(name, service)
    debugInfo('Service registered', { serviceName: name })
  }

  /**
   * Check if a service is registered
   */
  hasService(name: string): boolean {
    return this.services.has(name)
  }

  /**
   * Get the inventory sync service
   */
  getInventorySyncService(): InventorySyncService {
    return this.getService<InventorySyncService>('inventorySyncService')
  }

  /**
   * Get all service names for debugging
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys())
  }

  /**
   * Health check for all services
   */
  async healthCheckAll(): Promise<{
    healthy: boolean
    services: Record<string, any>
    timestamp: Date
  }> {
    const serviceStatuses: Record<string, any> = {}
    let overallHealthy = true

    // Check InventorySyncService
    if (this.hasService('inventorySyncService')) {
      try {
        const inventoryService = this.getInventorySyncService()
        const health = await inventoryService.healthCheck()
        serviceStatuses.inventorySyncService = health
        if (!health.healthy) {
          overallHealthy = false
        }
      } catch (error) {
        serviceStatuses.inventorySyncService = {
          healthy: false,
          error: (error as Error).message
        }
        overallHealthy = false
      }
    }

    // TODO: Add health checks for other services as they are created

    return {
      healthy: overallHealthy,
      services: serviceStatuses,
      timestamp: new Date()
    }
  }

  /**
   * Graceful shutdown of all services
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down services...')

    for (const [name, service] of this.services) {
      try {
        // Call shutdown method if it exists
        if (typeof service.shutdown === 'function') {
          await service.shutdown()
          debugInfo('Service shut down', { serviceName: name })
        }
      } catch (error) {
        logger.error('Error shutting down service', error as Error, { serviceName: name })
      }
    }

    this.services.clear()
    logger.info('All services shut down')
  }
}

// Export convenience function to get the container instance
export const getServiceContainer = (): ServiceContainer => {
  return ServiceContainer.getInstance()
}

// Export convenience function to get the inventory sync service
export const getInventorySyncService = (): InventorySyncService => {
  return getServiceContainer().getInventorySyncService()
}
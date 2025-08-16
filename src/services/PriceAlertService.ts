import { AppDataSource } from '../config/database'
import { PriceAlert, AlertType, AlertStatus } from '../entities/PriceAlert'
import { PriceHistory } from '../entities/PriceHistory'
import { WishlistItem } from '../entities/WishlistItem'
import { Repository, LessThan, In } from 'typeorm'
import { logger } from '../config/logger'

interface CreatePriceAlertDto {
  user_id: string
  catalog_sku: string
  alert_type: AlertType
  trigger_price?: number
  percentage_threshold?: number
  condition_filter?: string
  language_filter?: string
  email_enabled?: boolean
  sms_enabled?: boolean
  push_enabled?: boolean
  expires_at?: Date
}

interface PriceCheckResult {
  alerts_triggered: number
  notifications_sent: number
  errors: string[]
}

interface NotificationPayload {
  user_id: string
  alert_id: string
  catalog_sku: string
  alert_type: AlertType
  trigger_price?: number
  current_price: number
  percentage_change?: number
  card_name: string
  game_name: string
  notification_channels: {
    email: boolean
    sms: boolean
    push: boolean
  }
}

export class PriceAlertService {
  private priceAlertRepository: Repository<PriceAlert>
  private priceHistoryRepository: Repository<PriceHistory>
  private wishlistItemRepository: Repository<WishlistItem>

  constructor() {
    this.priceAlertRepository = AppDataSource.getRepository(PriceAlert)
    this.priceHistoryRepository = AppDataSource.getRepository(PriceHistory)
    this.wishlistItemRepository = AppDataSource.getRepository(WishlistItem)
  }

  /**
   * Create a new price alert
   */
  async createPriceAlert(dto: CreatePriceAlertDto): Promise<PriceAlert> {
    try {
      // Get current price as baseline
      const currentPrice = await this.getCurrentPrice(dto.catalog_sku)
      
      const alert = this.priceAlertRepository.create({
        ...dto,
        baseline_price: currentPrice || undefined,
        status: AlertStatus.ACTIVE
      })

      const savedAlert = await this.priceAlertRepository.save(alert)
      
      logger.info(`Created price alert ${savedAlert.id} for user ${dto.user_id}`, {
        catalog_sku: dto.catalog_sku,
        alert_type: dto.alert_type
      })

      return savedAlert
    } catch (error) {
      logger.error('Error creating price alert', error as Error)
      throw new Error(`Failed to create price alert: ${(error as Error).message}`)
    }
  }

  /**
   * Update price alert
   */
  async updatePriceAlert(alertId: string, updates: Partial<PriceAlert>): Promise<PriceAlert> {
    try {
      await this.priceAlertRepository.update(alertId, {
        ...updates,
        updated_at: new Date()
      })

      const updatedAlert = await this.priceAlertRepository.findOne({
        where: { id: alertId }
      })

      if (!updatedAlert) {
        throw new Error('Price alert not found')
      }

      return updatedAlert
    } catch (error) {
      logger.error('Error updating price alert', error as Error)
      throw new Error(`Failed to update price alert: ${(error as Error).message}`)
    }
  }

  /**
   * Delete price alert
   */
  async deletePriceAlert(alertId: string): Promise<void> {
    try {
      const result = await this.priceAlertRepository.delete(alertId)
      
      if (result.affected === 0) {
        throw new Error('Price alert not found')
      }

      logger.info(`Deleted price alert ${alertId}`)
    } catch (error) {
      logger.error('Error deleting price alert', error as Error)
      throw new Error(`Failed to delete price alert: ${(error as Error).message}`)
    }
  }

  /**
   * Get user's price alerts
   */
  async getUserPriceAlerts(userId: string): Promise<PriceAlert[]> {
    try {
      return await this.priceAlertRepository.find({
        where: { user_id: userId },
        order: { created_at: 'DESC' }
      })
    } catch (error) {
      logger.error('Error getting user price alerts', error as Error)
      throw new Error(`Failed to get price alerts: ${(error as Error).message}`)
    }
  }

  /**
   * Check all active price alerts and trigger notifications
   * This is the main background job function
   */
  async checkPriceAlerts(): Promise<PriceCheckResult> {
    const result: PriceCheckResult = {
      alerts_triggered: 0,
      notifications_sent: 0,
      errors: []
    }

    try {
      // Get all active alerts
      const activeAlerts = await this.priceAlertRepository.find({
        where: { 
          status: AlertStatus.ACTIVE,
          // Only check alerts that haven't been checked in the last hour
          last_checked_at: LessThan(new Date(Date.now() - 60 * 60 * 1000))
        },
        order: { last_checked_at: 'ASC' }
      })

      logger.info(`Checking ${activeAlerts.length} active price alerts`)

      // Process alerts in batches
      const batchSize = 50
      for (let i = 0; i < activeAlerts.length; i += batchSize) {
        const batch = activeAlerts.slice(i, i + batchSize)
        await this.processPriceAlertBatch(batch, result)
      }

      logger.info('Price alert check completed', {
        alerts_checked: activeAlerts.length,
        alerts_triggered: result.alerts_triggered,
        notifications_sent: result.notifications_sent,
        errors: result.errors.length
      })

      return result
    } catch (error) {
      logger.error('Error checking price alerts', error as Error)
      result.errors.push(`Batch processing error: ${(error as Error).message}`)
      return result
    }
  }

  /**
   * Process a batch of price alerts
   */
  private async processPriceAlertBatch(alerts: PriceAlert[], result: PriceCheckResult): Promise<void> {
    for (const alert of alerts) {
      try {
        await this.processSingleAlert(alert, result)
      } catch (error) {
        logger.error(`Error processing alert ${alert.id}`, error as Error)
        result.errors.push(`Alert ${alert.id}: ${(error as Error).message}`)
      }
    }
  }

  /**
   * Process a single price alert
   */
  private async processSingleAlert(alert: PriceAlert, result: PriceCheckResult): Promise<void> {
    // Update last_checked_at
    await this.priceAlertRepository.update(alert.id, {
      last_checked_at: new Date()
    })

    // Get current price
    const currentPrice = await this.getCurrentPrice(alert.catalog_sku)
    
    if (!currentPrice) {
      logger.warn(`No price found for SKU ${alert.catalog_sku}`)
      return
    }

    // Check if alert should trigger
    const shouldTrigger = this.shouldTriggerAlert(alert, currentPrice)
    
    if (!shouldTrigger) {
      return
    }

    // Trigger alert
    await this.triggerAlert(alert, currentPrice)
    result.alerts_triggered++

    // Send notifications
    const notificationsSent = await this.sendNotifications(alert, currentPrice)
    result.notifications_sent += notificationsSent

    logger.info(`Triggered alert ${alert.id} for user ${alert.user_id}`, {
      catalog_sku: alert.catalog_sku,
      trigger_price: alert.trigger_price,
      current_price: currentPrice
    })
  }

  /**
   * Check if an alert should trigger based on current price
   */
  private shouldTriggerAlert(alert: PriceAlert, currentPrice: number): boolean {
    switch (alert.alert_type) {
      case AlertType.PRICE_DROP:
        if (alert.trigger_price) {
          return currentPrice <= alert.trigger_price
        }
        if (alert.percentage_threshold && alert.baseline_price) {
          const percentageChange = ((alert.baseline_price - currentPrice) / alert.baseline_price) * 100
          return percentageChange >= alert.percentage_threshold
        }
        return false

      case AlertType.PRICE_TARGET:
        return alert.trigger_price ? currentPrice <= alert.trigger_price : false

      case AlertType.BACK_IN_STOCK:
        // This would need integration with inventory system
        return false

      case AlertType.NEW_LISTING:
        // This would need integration with new listing detection
        return false

      default:
        return false
    }
  }

  /**
   * Trigger an alert and update its status
   */
  private async triggerAlert(alert: PriceAlert, currentPrice: number): Promise<void> {
    const newTriggerCount = alert.trigger_count + 1
    const shouldDisable = alert.auto_disable_after_trigger || newTriggerCount >= alert.max_triggers

    await this.priceAlertRepository.update(alert.id, {
      status: shouldDisable ? AlertStatus.TRIGGERED : AlertStatus.ACTIVE,
      last_triggered_at: new Date(),
      trigger_count: newTriggerCount
    })

    // Update related wishlist items
    await this.updateWishlistItemPrices(alert.catalog_sku, currentPrice)
  }

  /**
   * Send notifications for triggered alert
   */
  private async sendNotifications(alert: PriceAlert, currentPrice: number): Promise<number> {
    let notificationsSent = 0

    try {
      // Get card details for notification
      const cardData = await this.getCardDataForSKU(alert.catalog_sku)
      
      if (!cardData) {
        logger.warn(`No card data found for SKU ${alert.catalog_sku}`)
        return notificationsSent
      }

      const notificationPayload: NotificationPayload = {
        user_id: alert.user_id,
        alert_id: alert.id,
        catalog_sku: alert.catalog_sku,
        alert_type: alert.alert_type,
        trigger_price: alert.trigger_price,
        current_price: currentPrice,
        percentage_change: alert.baseline_price ? 
          ((alert.baseline_price - currentPrice) / alert.baseline_price) * 100 : undefined,
        card_name: cardData.card_name,
        game_name: cardData.game_name,
        notification_channels: {
          email: alert.email_enabled,
          sms: alert.sms_enabled,
          push: alert.push_enabled
        }
      }

      // Send email notification
      if (alert.email_enabled) {
        await this.sendEmailNotification(notificationPayload)
        notificationsSent++
      }

      // Send SMS notification
      if (alert.sms_enabled) {
        await this.sendSMSNotification(notificationPayload)
        notificationsSent++
      }

      // Send push notification
      if (alert.push_enabled) {
        await this.sendPushNotification(notificationPayload)
        notificationsSent++
      }

    } catch (error) {
      logger.error(`Error sending notifications for alert ${alert.id}`, error as Error)
    }

    return notificationsSent
  }

  /**
   * Get current price for a catalog SKU
   */
  private async getCurrentPrice(catalogSku: string): Promise<number | null> {
    try {
      // Query the latest price from price history or current market data
      const latestPrice = await AppDataSource.query(`
        SELECT cs.market_price, cs.min_price, cs.avg_price
        FROM catalog_skus cs
        WHERE cs.sku = $1
      `, [catalogSku])

      if (latestPrice && latestPrice.length > 0) {
        return latestPrice[0].market_price || latestPrice[0].avg_price || latestPrice[0].min_price
      }

      return null
    } catch (error) {
      logger.error(`Error getting current price for SKU ${catalogSku}`, error as Error)
      return null
    }
  }

  /**
   * Update wishlist item prices when alerts trigger
   */
  private async updateWishlistItemPrices(catalogSku: string, currentPrice: number): Promise<void> {
    try {
      await this.wishlistItemRepository.update(
        { catalog_sku: catalogSku },
        { 
          current_lowest_price: currentPrice,
          updated_at: new Date()
        }
      )
    } catch (error) {
      logger.error(`Error updating wishlist item prices for SKU ${catalogSku}`, error as Error)
    }
  }

  /**
   * Get card data for notifications
   */
  private async getCardDataForSKU(catalogSku: string): Promise<{ card_name: string, game_name: string } | null> {
    try {
      const cardData = await AppDataSource.query(`
        SELECT c.name as card_name, g.name as game_name
        FROM catalog_skus cs
        LEFT JOIN prints p ON cs.print_id = p.id
        LEFT JOIN cards c ON p.card_id = c.id
        LEFT JOIN games g ON c.game_id = g.id
        WHERE cs.sku = $1
      `, [catalogSku])

      return cardData && cardData.length > 0 ? cardData[0] : null
    } catch (error) {
      logger.error(`Error getting card data for SKU ${catalogSku}`, error as Error)
      return null
    }
  }

  /**
   * Notification methods (to be implemented with actual services)
   */
  private async sendEmailNotification(payload: NotificationPayload): Promise<void> {
    // TODO: Integrate with email service (e.g., Resend, SendGrid)
    logger.info(`Would send email notification to user ${payload.user_id}`, {
      card_name: payload.card_name,
      current_price: payload.current_price
    })
  }

  private async sendSMSNotification(payload: NotificationPayload): Promise<void> {
    // TODO: Integrate with SMS service (e.g., Twilio)
    logger.info(`Would send SMS notification to user ${payload.user_id}`, {
      card_name: payload.card_name,
      current_price: payload.current_price
    })
  }

  private async sendPushNotification(payload: NotificationPayload): Promise<void> {
    // TODO: Integrate with push notification service
    logger.info(`Would send push notification to user ${payload.user_id}`, {
      card_name: payload.card_name,
      current_price: payload.current_price
    })
  }

  /**
   * Cleanup expired alerts
   */
  async cleanupExpiredAlerts(): Promise<number> {
    try {
      const result = await this.priceAlertRepository.update(
        { 
          expires_at: LessThan(new Date()),
          status: AlertStatus.ACTIVE
        },
        { status: AlertStatus.EXPIRED }
      )

      logger.info(`Marked ${result.affected} alerts as expired`)
      return result.affected || 0
    } catch (error) {
      logger.error('Error cleaning up expired alerts', error as Error)
      return 0
    }
  }
}
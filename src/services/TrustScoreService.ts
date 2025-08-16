import { Repository } from 'typeorm'
import { AppDataSource } from '../config/database'
import { SellerRating, SellerTier, VerificationStatus } from '../entities/SellerRating'
import { SellerReview, ReviewStatus } from '../entities/SellerReview'
import { logger } from '../config/logger'

export interface TrustScoreFactors {
  rating_score: number
  volume_score: number
  experience_score: number
  performance_score: number
  verification_score: number
  dispute_score: number
  consistency_score: number
  recency_score: number
}

export interface TrustScoreAnalysis {
  seller_id: string
  current_trust_score: number
  previous_trust_score: number
  score_change: number
  tier_change?: {
    from: SellerTier
    to: SellerTier
  }
  factors: TrustScoreFactors
  recommendations: string[]
  risk_indicators: string[]
  calculated_at: Date
}

export interface SellerPerformanceMetrics {
  seller_id: string
  total_orders: number
  total_revenue: number
  average_order_value: number
  response_time_hours: number
  shipping_time_days: number
  return_rate_percentage: number
  repeat_customer_rate: number
  monthly_growth_rate: number
}

export class TrustScoreService {
  private ratingRepo: Repository<SellerRating>
  private reviewRepo: Repository<SellerReview>

  constructor() {
    this.ratingRepo = AppDataSource.getRepository(SellerRating)
    this.reviewRepo = AppDataSource.getRepository(SellerReview)
  }

  /**
   * Calculate comprehensive trust score for a seller
   */
  async calculateTrustScore(sellerId: string): Promise<TrustScoreAnalysis> {
    try {
      const sellerRating = await this.ratingRepo.findOne({ where: { seller_id: sellerId } })
      
      if (!sellerRating) {
        throw new Error(`Seller rating not found for seller ${sellerId}`)
      }

      const previousTrustScore = sellerRating.trust_score
      const previousTier = sellerRating.seller_tier

      // Get recent performance data
      const performanceMetrics = await this.getPerformanceMetrics(sellerId)
      
      // Calculate individual factor scores
      const factors = await this.calculateTrustFactors(sellerId, sellerRating, performanceMetrics)
      
      // Calculate weighted trust score (0-1000)
      const trustScore = this.calculateWeightedTrustScore(factors)
      
      // Determine new tier
      const newTier = this.calculateSellerTier(trustScore, sellerRating)
      
      // Generate recommendations and risk indicators
      const recommendations = this.generateRecommendations(factors, sellerRating)
      const riskIndicators = this.identifyRiskIndicators(factors, sellerRating)
      
      // Update seller rating with new trust score and tier
      await this.updateSellerTrustData(sellerId, trustScore, newTier, factors)
      
      const analysis: TrustScoreAnalysis = {
        seller_id: sellerId,
        current_trust_score: trustScore,
        previous_trust_score: previousTrustScore,
        score_change: trustScore - previousTrustScore,
        tier_change: previousTier !== newTier ? { from: previousTier, to: newTier } : undefined,
        factors,
        recommendations,
        risk_indicators: riskIndicators,
        calculated_at: new Date()
      }

      logger.info(`Trust score calculated for seller ${sellerId}: ${trustScore} (${newTier})`)
      return analysis

    } catch (error) {
      logger.error(`Error calculating trust score for seller ${sellerId}`, error as Error)
      throw error
    }
  }

  /**
   * Calculate individual trust factors
   */
  private async calculateTrustFactors(
    sellerId: string, 
    sellerRating: SellerRating,
    performanceMetrics: SellerPerformanceMetrics
  ): Promise<TrustScoreFactors> {
    // Rating Score (0-200) - Based on review ratings
    const rating_score = this.calculateRatingScore(sellerRating)
    
    // Volume Score (0-150) - Based on transaction volume and history
    const volume_score = this.calculateVolumeScore(sellerRating, performanceMetrics)
    
    // Experience Score (0-100) - Based on time active and consistency
    const experience_score = this.calculateExperienceScore(sellerRating)
    
    // Performance Score (0-200) - Based on shipping, response time, etc.
    const performance_score = this.calculatePerformanceScore(sellerRating, performanceMetrics)
    
    // Verification Score (0-150) - Based on identity and business verification
    const verification_score = this.calculateVerificationScore(sellerRating)
    
    // Dispute Score (0-100) - Negative score based on disputes and issues
    const dispute_score = this.calculateDisputeScore(sellerRating)
    
    // Consistency Score (0-100) - Based on performance consistency over time
    const consistency_score = await this.calculateConsistencyScore(sellerId, sellerRating)
    
    // Recency Score (0-100) - Based on recent activity and performance
    const recency_score = this.calculateRecencyScore(sellerRating)

    return {
      rating_score,
      volume_score,
      experience_score,
      performance_score,
      verification_score,
      dispute_score,
      consistency_score,
      recency_score
    }
  }

  /**
   * Calculate rating-based score (0-200)
   */
  private calculateRatingScore(sellerRating: SellerRating): number {
    if (sellerRating.total_reviews === 0) return 0
    
    const baseScore = (sellerRating.overall_rating / 5) * 100 // 0-100
    const volumeBonus = Math.min(sellerRating.total_reviews / 10, 50) // Up to 50 bonus
    const recentBonus = sellerRating.recent_average_rating > sellerRating.overall_rating ? 25 : 0 // Improving trend
    const breakdownBonus = this.calculateBreakdownBonus(sellerRating) // Up to 25
    
    return Math.min(200, baseScore + volumeBonus + recentBonus + breakdownBonus)
  }

  private calculateBreakdownBonus(sellerRating: SellerRating): number {
    const ratings = [
      sellerRating.item_as_described_rating,
      sellerRating.shipping_speed_rating,
      sellerRating.communication_rating,
      sellerRating.packaging_rating
    ]
    
    const hasBreakdown = ratings.every(r => r > 0)
    if (!hasBreakdown) return 0
    
    const avgBreakdown = ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    return avgBreakdown >= 4.5 ? 25 : avgBreakdown >= 4.0 ? 15 : 5
  }

  /**
   * Calculate volume-based score (0-150)
   */
  private calculateVolumeScore(
    sellerRating: SellerRating, 
    performanceMetrics: SellerPerformanceMetrics
  ): number {
    const orderScore = Math.min((sellerRating.total_orders / 100) * 50, 50) // Up to 50
    const revenueScore = Math.min((performanceMetrics.total_revenue / 100000) * 50, 50) // Up to 50
    const growthScore = performanceMetrics.monthly_growth_rate > 0 ? 
      Math.min(performanceMetrics.monthly_growth_rate * 10, 50) : 0 // Up to 50
    
    return Math.min(150, orderScore + revenueScore + growthScore)
  }

  /**
   * Calculate experience-based score (0-100)
   */
  private calculateExperienceScore(sellerRating: SellerRating): number {
    const monthsScore = Math.min(sellerRating.months_active * 2, 60) // Up to 60
    const consistencyScore = Math.min(sellerRating.consecutive_months_active * 3, 40) // Up to 40
    
    return Math.min(100, monthsScore + consistencyScore)
  }

  /**
   * Calculate performance-based score (0-200)
   */
  private calculatePerformanceScore(
    sellerRating: SellerRating, 
    performanceMetrics: SellerPerformanceMetrics
  ): number {
    const responseScore = (sellerRating.response_rate_percentage / 100) * 50 // Up to 50
    const shippingScore = (sellerRating.on_time_shipping_percentage / 100) * 50 // Up to 50
    
    // Response time score (lower is better)
    const responseTimeScore = performanceMetrics.response_time_hours <= 2 ? 50 :
                             performanceMetrics.response_time_hours <= 6 ? 35 :
                             performanceMetrics.response_time_hours <= 24 ? 20 : 5 // Up to 50
    
    // Repeat customer score
    const repeatScore = performanceMetrics.repeat_customer_rate * 50 // Up to 50
    
    return Math.min(200, responseScore + shippingScore + responseTimeScore + repeatScore)
  }

  /**
   * Calculate verification-based score (0-150)
   */
  private calculateVerificationScore(sellerRating: SellerRating): number {
    let score = 0
    
    if (sellerRating.verification_status === VerificationStatus.VERIFIED) score += 50
    if (sellerRating.is_identity_verified) score += 25
    if (sellerRating.is_business_verified) score += 25
    if (sellerRating.is_address_verified) score += 25
    if (sellerRating.is_payment_verified) score += 25
    
    return Math.min(150, score)
  }

  /**
   * Calculate dispute-based score (0-100, but it's a penalty)
   */
  private calculateDisputeScore(sellerRating: SellerRating): number {
    const disputePenalty = sellerRating.dispute_rate_percentage * 10 // High penalty for disputes
    const cancellationPenalty = sellerRating.cancellation_rate_percentage * 5 // Moderate penalty for cancellations
    
    return Math.max(0, 100 - disputePenalty - cancellationPenalty)
  }

  /**
   * Calculate consistency score (0-100)
   */
  private async calculateConsistencyScore(sellerId: string, sellerRating: SellerRating): Promise<number> {
    if (!sellerRating.monthly_performance || sellerRating.monthly_performance.length < 3) {
      return 50 // Default for insufficient data
    }

    const performances = sellerRating.monthly_performance as Array<{
      month: string
      orders: number
      rating: number
      revenue: number
      disputes: number
    }>

    // Calculate coefficient of variation for ratings (lower is better)
    const ratings = performances.map(p => p.rating).filter(r => r > 0)
    if (ratings.length === 0) return 50

    const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    const variance = ratings.reduce((sum, r) => sum + Math.pow(r - avgRating, 2), 0) / ratings.length
    const stdDev = Math.sqrt(variance)
    const coefficientOfVariation = stdDev / avgRating

    // Lower variation = higher score
    const consistencyScore = Math.max(0, 100 - (coefficientOfVariation * 100))
    
    return Math.min(100, consistencyScore)
  }

  /**
   * Calculate recency score (0-100)
   */
  private calculateRecencyScore(sellerRating: SellerRating): number {
    const now = new Date()
    
    // Recent activity score
    let activityScore = 0
    if (sellerRating.last_order_at) {
      const daysSinceLastOrder = (now.getTime() - sellerRating.last_order_at.getTime()) / (1000 * 60 * 60 * 24)
      activityScore = daysSinceLastOrder <= 7 ? 50 :
                     daysSinceLastOrder <= 30 ? 35 :
                     daysSinceLastOrder <= 90 ? 20 : 5
    }
    
    // Recent performance score
    const recentPerformanceScore = sellerRating.recent_orders_count > 0 ? 
      Math.min(sellerRating.recent_orders_count * 5, 50) : 0
    
    return Math.min(100, activityScore + recentPerformanceScore)
  }

  /**
   * Calculate weighted trust score from factors
   */
  private calculateWeightedTrustScore(factors: TrustScoreFactors): number {
    const weights = {
      rating_score: 0.25,      // 25% - Most important
      performance_score: 0.20,  // 20% - Very important
      volume_score: 0.15,      // 15% - Important for scale
      verification_score: 0.15, // 15% - Important for trust
      dispute_score: 0.10,     // 10% - Penalty factor
      experience_score: 0.05,   // 5% - Moderate importance
      consistency_score: 0.05,  // 5% - Moderate importance
      recency_score: 0.05       // 5% - Recent activity
    }

    const weightedScore = 
      factors.rating_score * weights.rating_score +
      factors.performance_score * weights.performance_score +
      factors.volume_score * weights.volume_score +
      factors.verification_score * weights.verification_score +
      factors.dispute_score * weights.dispute_score +
      factors.experience_score * weights.experience_score +
      factors.consistency_score * weights.consistency_score +
      factors.recency_score * weights.recency_score

    return Math.round(Math.min(1000, Math.max(0, weightedScore)))
  }

  /**
   * Calculate seller tier based on trust score
   */
  private calculateSellerTier(trustScore: number, sellerRating: SellerRating): SellerTier {
    // Special tier requirements
    if (sellerRating.is_top_rated && trustScore >= 900) return SellerTier.DIAMOND
    if (trustScore >= 800 && sellerRating.total_reviews >= 100) return SellerTier.PLATINUM
    if (trustScore >= 650 && sellerRating.total_reviews >= 50) return SellerTier.GOLD
    if (trustScore >= 450 && sellerRating.total_reviews >= 25) return SellerTier.SILVER
    
    return SellerTier.BRONZE
  }

  /**
   * Generate recommendations for improvement
   */
  private generateRecommendations(factors: TrustScoreFactors, sellerRating: SellerRating): string[] {
    const recommendations: string[] = []

    if (factors.rating_score < 120) {
      recommendations.push('Focus on improving customer satisfaction and review ratings')
    }
    
    if (factors.performance_score < 120) {
      recommendations.push('Improve response times and shipping speed')
    }
    
    if (factors.verification_score < 100) {
      recommendations.push('Complete identity and business verification')
    }
    
    if (factors.dispute_score < 80) {
      recommendations.push('Address customer concerns to reduce dispute rates')
    }
    
    if (factors.volume_score < 75) {
      recommendations.push('Increase sales volume and customer base')
    }
    
    if (factors.consistency_score < 70) {
      recommendations.push('Maintain consistent performance across all metrics')
    }

    return recommendations
  }

  /**
   * Identify risk indicators
   */
  private identifyRiskIndicators(factors: TrustScoreFactors, sellerRating: SellerRating): string[] {
    const risks: string[] = []

    if (sellerRating.dispute_rate_percentage > 10) {
      risks.push('High dispute rate indicates potential issues')
    }
    
    if (sellerRating.cancellation_rate_percentage > 15) {
      risks.push('High cancellation rate may indicate inventory issues')
    }
    
    if (sellerRating.recent_average_rating < sellerRating.overall_rating - 0.5) {
      risks.push('Declining recent performance trend')
    }
    
    if (factors.recency_score < 30) {
      risks.push('Low recent activity may indicate inactive seller')
    }
    
    if (sellerRating.verification_status === VerificationStatus.UNVERIFIED) {
      risks.push('Unverified seller poses higher risk')
    }

    return risks
  }

  /**
   * Get performance metrics from external sources
   */
  private async getPerformanceMetrics(sellerId: string): Promise<SellerPerformanceMetrics> {
    try {
      // This would integrate with MedusaJS to get actual order data
      // For now, returning mock data based on seller rating
      const sellerRating = await this.ratingRepo.findOne({ where: { seller_id: sellerId } })
      
      if (!sellerRating) {
        throw new Error('Seller rating not found')
      }

      // Mock performance metrics - in real implementation, query actual order data
      return {
        seller_id: sellerId,
        total_orders: sellerRating.total_orders,
        total_revenue: sellerRating.total_sales_volume,
        average_order_value: sellerRating.total_orders > 0 ? 
          sellerRating.total_sales_volume / sellerRating.total_orders : 0,
        response_time_hours: 6, // Would calculate from actual message data
        shipping_time_days: 3, // Would calculate from actual shipping data
        return_rate_percentage: 2.5, // Would calculate from return data
        repeat_customer_rate: 0.3, // Would calculate from customer order history
        monthly_growth_rate: 0.1 // Would calculate from monthly sales trend
      }
    } catch (error) {
      logger.error(`Error getting performance metrics for seller ${sellerId}`, error as Error)
      throw error
    }
  }

  /**
   * Update seller with new trust data
   */
  private async updateSellerTrustData(
    sellerId: string, 
    trustScore: number, 
    tier: SellerTier,
    factors: TrustScoreFactors
  ): Promise<void> {
    try {
      const updates: Partial<SellerRating> = {
        trust_score: trustScore,
        seller_tier: tier,
        updated_at: new Date()
      }

      // Update special status flags based on score and tier
      if (trustScore >= 900 && tier === SellerTier.DIAMOND) {
        updates.is_top_rated = true
      }
      
      if (trustScore >= 750) {
        updates.is_power_seller = true
      }
      
      if (trustScore >= 650) {
        updates.is_preferred_seller = true
      }

      await this.ratingRepo.update({ seller_id: sellerId }, updates)

      logger.info(`Updated trust data for seller ${sellerId}: score=${trustScore}, tier=${tier}`)
    } catch (error) {
      logger.error(`Error updating trust data for seller ${sellerId}`, error as Error)
      throw error
    }
  }

  /**
   * Batch calculate trust scores for multiple sellers
   */
  async batchCalculateTrustScores(sellerIds: string[]): Promise<TrustScoreAnalysis[]> {
    const results: TrustScoreAnalysis[] = []
    
    for (const sellerId of sellerIds) {
      try {
        const analysis = await this.calculateTrustScore(sellerId)
        results.push(analysis)
      } catch (error) {
        logger.error(`Error calculating trust score for seller ${sellerId}`, error as Error)
      }
    }
    
    return results
  }

  /**
   * Get trust score history for a seller
   */
  async getTrustScoreHistory(sellerId: string): Promise<Array<{
    date: Date
    trust_score: number
    tier: SellerTier
  }>> {
    try {
      // This would require a trust_score_history table to track changes over time
      // For now, return current data
      const sellerRating = await this.ratingRepo.findOne({ where: { seller_id: sellerId } })
      
      if (!sellerRating) {
        return []
      }

      return [{
        date: sellerRating.updated_at,
        trust_score: sellerRating.trust_score,
        tier: sellerRating.seller_tier
      }]
    } catch (error) {
      logger.error(`Error getting trust score history for seller ${sellerId}`, error as Error)
      return []
    }
  }
}
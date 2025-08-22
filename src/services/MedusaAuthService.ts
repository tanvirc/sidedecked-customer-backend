import axios, { AxiosInstance, AxiosError } from 'axios'
import { logger } from '../config/logger'
import { config } from '../config/env'
import { debugInfo } from '../utils/debug'

interface AuthTokens {
  token: string
  refreshToken?: string
  expiresAt: Date
}

interface LoginResponse {
  token: string
  user?: {
    id: string
    email: string
  }
}

/**
 * Service to handle authentication with Medusa backend
 * Manages JWT tokens and provides authenticated HTTP client
 */
export class MedusaAuthService {
  private httpClient: AxiosInstance
  private authTokens: AuthTokens | null = null
  private isAuthenticating = false
  private authPromise: Promise<void> | null = null

  constructor() {
    // Create base HTTP client without auth headers
    this.httpClient = axios.create({
      baseURL: config.COMMERCE_BACKEND_URL || 'http://localhost:9000',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SideDecked-CustomerBackend/1.0'
      }
    })

    // Add request interceptor to inject auth token
    this.httpClient.interceptors.request.use(
      async (requestConfig) => {
        // Skip auth for login endpoint
        if (requestConfig.url?.includes('/auth/user/emailpass')) {
          return requestConfig
        }

        // Ensure we have valid auth tokens
        await this.ensureAuthenticated()

        if (this.authTokens?.token) {
          requestConfig.headers.Authorization = `Bearer ${this.authTokens.token}`
        }

        return requestConfig
      },
      (error) => Promise.reject(error)
    )

    // Add response interceptor to handle auth errors
    this.httpClient.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any

        // If 401 and not already retrying, try to refresh token
        if (error.response?.status === 401 && originalRequest && !originalRequest.headers?.['X-Retry']) {
          logger.info('Received 401, attempting to re-authenticate')
          
          // Clear current tokens
          this.authTokens = null
          
          // Re-authenticate
          await this.authenticate()
          
          // Retry original request
          if (originalRequest.headers) {
            originalRequest.headers['X-Retry'] = 'true'
            const tokens = this.authTokens as AuthTokens | null
            if (tokens?.token) {
              originalRequest.headers.Authorization = `Bearer ${tokens.token}`
            }
          }
          
          return this.httpClient.request(originalRequest)
        }

        return Promise.reject(error)
      }
    )

    logger.info('MedusaAuthService initialized', {
      backendUrl: config.COMMERCE_BACKEND_URL
    })
  }

  /**
   * Authenticate with Medusa backend using service account credentials
   */
  private async authenticate(): Promise<void> {
    // If already authenticating, wait for it to complete
    if (this.isAuthenticating && this.authPromise) {
      return this.authPromise
    }

    this.isAuthenticating = true
    this.authPromise = this.performAuthentication()

    try {
      await this.authPromise
    } finally {
      this.isAuthenticating = false
      this.authPromise = null
    }
  }

  /**
   * Perform the actual authentication
   */
  private async performAuthentication(): Promise<void> {
    const email = process.env.COMMERCE_SERVICE_EMAIL
    const password = process.env.COMMERCE_SERVICE_PASSWORD

    if (!email || !password) {
      logger.error('Service account credentials not configured')
      throw new Error('Missing COMMERCE_SERVICE_EMAIL or COMMERCE_SERVICE_PASSWORD environment variables')
    }

    try {
      logger.info('Authenticating with Medusa backend', { email })

      // Try different authentication endpoints
      let response: any
      
      try {
        // Try admin auth endpoint
        response = await this.httpClient.post<LoginResponse>('/admin/auth', {
          email,
          password
        })
      } catch (adminError) {
        debugInfo('Admin auth failed, trying user auth', { error: (adminError as Error).message })
        
        // Fallback to user auth endpoint
        response = await this.httpClient.post<LoginResponse>('/auth/user/emailpass', {
          email,
          password
        })
      }

      if (response.data.token) {
        this.authTokens = {
          token: response.data.token,
          // Token expires in 7 days by default in Medusa
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }

        logger.info('Successfully authenticated with Medusa backend', {
          userId: response.data.user?.id,
          expiresAt: this.authTokens.expiresAt
        })
      } else {
        throw new Error('No token received from authentication endpoint')
      }
    } catch (error) {
      logger.error('Failed to authenticate with Medusa backend', error as Error)
      throw error
    }
  }

  /**
   * Ensure we have valid authentication before making requests
   */
  private async ensureAuthenticated(): Promise<void> {
    // If we don't have tokens or they're expired, authenticate
    if (!this.authTokens || this.isTokenExpired()) {
      await this.authenticate()
    }
  }

  /**
   * Check if current token is expired
   */
  private isTokenExpired(): boolean {
    if (!this.authTokens) return true
    
    // Consider token expired 5 minutes before actual expiry
    const expiryBuffer = 5 * 60 * 1000
    return new Date().getTime() > (this.authTokens.expiresAt.getTime() - expiryBuffer)
  }

  /**
   * Get authenticated HTTP client for making requests
   */
  getHttpClient(): AxiosInstance {
    return this.httpClient
  }

  /**
   * Manually trigger authentication (useful for testing)
   */
  async forceAuthenticate(): Promise<void> {
    this.authTokens = null
    await this.authenticate()
  }

  /**
   * Check if currently authenticated
   */
  isAuthenticated(): boolean {
    return !!this.authTokens && !this.isTokenExpired()
  }

  /**
   * Get current auth status
   */
  getAuthStatus(): { authenticated: boolean; expiresAt?: Date } {
    return {
      authenticated: this.isAuthenticated(),
      expiresAt: this.authTokens?.expiresAt
    }
  }
}

// Export singleton instance
export const medusaAuthService = new MedusaAuthService()
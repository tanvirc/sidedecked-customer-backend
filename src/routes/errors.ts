import { Router, Request, Response } from 'express'
import { debugLog } from '../utils/debug'

const router = Router()

interface ErrorReport {
  message: string
  stack?: string
  componentStack?: string
  url: string
  userAgent: string
  timestamp: string
  context?: string
  asyncError?: boolean
  errorBoundary?: boolean
  userId?: string
  sessionId?: string
}

// POST /api/errors/report - Report client-side errors
router.post('/report', async (req: Request, res: Response) => {
  try {
    const errorReport: ErrorReport = req.body
    
    // Validate required fields
    if (!errorReport.message || !errorReport.url || !errorReport.timestamp) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ERROR_REPORT',
          message: 'Missing required fields: message, url, timestamp',
          timestamp: new Date().toISOString()
        }
      })
    }

    // Log error to console (in production, this would go to a logging service)
    console.error('Client Error Report:', {
      message: errorReport.message,
      url: errorReport.url,
      userAgent: errorReport.userAgent,
      timestamp: errorReport.timestamp,
      context: errorReport.context || 'unknown',
      hasStack: !!errorReport.stack,
      hasComponentStack: !!errorReport.componentStack,
      isAsyncError: errorReport.asyncError || false,
      isErrorBoundary: errorReport.errorBoundary || false
    })

    // If there's a stack trace, log it separately for better readability
    if (errorReport.stack) {
      console.error('Stack Trace:', errorReport.stack)
    }

    if (errorReport.componentStack) {
      console.error('Component Stack:', errorReport.componentStack)
    }

    debugLog('Error report received', {
      url: errorReport.url,
      message: errorReport.message.substring(0, 100),
      context: errorReport.context
    })

    // In production, you might want to:
    // 1. Store errors in a database
    // 2. Send to error tracking services (Sentry, Bugsnag, etc.)
    // 3. Set up alerting for critical errors
    // 4. Rate limit error reports to prevent spam

    res.json({
      success: true,
      message: 'Error report received and logged',
      reportId: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Failed to process error report:', error)
    
    res.status(500).json({
      success: false,
      error: {
        code: 'ERROR_REPORT_PROCESSING_FAILED',
        message: 'Failed to process error report',
        timestamp: new Date().toISOString()
      }
    })
  }
})

// GET /api/errors/health - Health check for error reporting service
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'Error Reporting Service',
    status: 'healthy',
    timestamp: new Date().toISOString()
  })
})

export default router
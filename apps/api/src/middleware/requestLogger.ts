import { Request, Response, NextFunction } from 'express'

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now()
  
  // Log the request
  console.log(`→ ${req.method} ${req.path}`, {
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    body: req.method !== 'GET' && Object.keys(req.body).length > 0 ? '...' : undefined,
    userAgent: req.get('User-Agent')?.substring(0, 50),
    ip: req.ip
  })

  // Override res.json to log the response
  const originalJson = res.json
  res.json = function(body: any) {
    const duration = Date.now() - start
    const size = JSON.stringify(body).length
    
    console.log(`← ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms - ${size} bytes`)
    
    return originalJson.call(this, body)
  }

  next()
}
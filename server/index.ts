import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";
import { log } from "./logger";
import { tastytradeService } from "./services/tastytradeService";
import { polygonService } from "./services/polygonService";
import { robinhoodService } from "./services/robinhoodService";
import { EliteStrategyEngine } from "./services/eliteStrategyEngine";
import { RecommendationTracker } from "./services/recommendationTracker";
import { GhostScheduler } from "./services/ghostScheduler";
import { eodCacheService } from "./services/eodCache";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize Polygon service on startup (primary data source)
  polygonService.initialize().then(success => {
    if (success) {
      console.log('✅ Polygon WebSocket service ready - unlimited live data enabled');
    } else {
      console.warn('⚠️ Polygon initialization failed, will use Tastytrade as fallback');
    }
  }).catch(err => {
    console.warn('⚠️ Polygon initialization failed:', err.message);
  });

  // Initialize Tastytrade service on startup (fallback data source)
  tastytradeService.init().catch(err => {
    console.warn('⚠️ Tastytrade initialization failed, will use other fallback sources:', err.message);
  });

  // Initialize Robinhood service on startup (optional broker integration)
  robinhoodService.initialize().catch(err => {
    console.log('ℹ️ Robinhood service not initialized:', err.message);
  });
  
  // Initialize Elite Strategy Engine with parameters from database
  console.log('🧠 Initializing Elite Strategy Engine...');
  await RecommendationTracker.initializeDefaultParameters();
  await EliteStrategyEngine.getInstance().loadParametersFromDatabase();
  console.log('✅ Elite Strategy Engine ready with active parameters');
  
  // DISABLED: Ghost 1DTE Scheduler (causing API rate limits with 500+ S&P requests)
  // GhostScheduler.start();
  
  // Start Recommendation Auto-Refresh Service (15min interval during market hours)
  const { RecommendationRefreshService } = await import('./services/recommendationRefreshService');
  RecommendationRefreshService.start();
  console.log('✅ Recommendation auto-refresh service started');
  
  // ACTIVATE EOD CACHE — DAILY 4:05 PM EST
  eodCacheService.startScheduler();
  console.log('✅ EOD Cache scheduler started - daily snapshot at 3:00 PM CST');
  
  // 24/7 AUTO-SCAN — ELITE SCANNER ONLY (Ghost disabled to prevent API rate limits)
  const { eliteScanner } = await import('./services/eliteScanner');
  
  let isAutoScanRunning = false;
  
  const runAutoScan = async () => {
    // Prevent overlapping scans
    if (isAutoScanRunning) {
      console.warn('⏭️ AUTO-SCAN skipped — previous scan still running');
      return;
    }
    
    isAutoScanRunning = true;
    const startTime = Date.now();
    
    try {
      console.log('🔄 24/7 AUTO-SCAN — Running Elite scanner...');
      const results = await eliteScanner.scan();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const elitePlays = results.results?.length || 0;
      
      console.log(`✅ Elite Scanner complete (${duration}s) — ${elitePlays} plays found`);
    } catch (error: any) {
      console.error('❌ Elite Scanner failed:', error.message);
    } finally {
      isAutoScanRunning = false;
    }
  };
  
  // Run initial scan on startup (after 30s delay for services to initialize)
  setTimeout(runAutoScan, 30000);
  
  // Run auto-scan every 5 minutes
  setInterval(runAutoScan, 5 * 60 * 1000);
  console.log('✅ 24/7 auto-scan activated — running every 5 minutes');
  
  // Start trade exit monitoring (runs daily at 4:15 PM ET to track recommendation outcomes)
  const { TradeExitMonitor } = await import('./services/tradeExitMonitor');
  TradeExitMonitor.start();
  
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();

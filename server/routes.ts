import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebScraperService } from "./services/webScraper";
import { AIAnalysisService } from "./services/aiAnalysis";
import { PositionAnalysisService } from "./services/positionAnalysis";
import { polygonService } from "./services/polygonService";
import { tastytradeService } from "./services/tastytradeService";
import { BlackScholesCalculator } from "./services/financialCalculations";
import { exitAnalysisService } from "./services/exitAnalysis";
import { insertMarketDataSchema, insertOptionsTradeSchema, insertAiInsightsSchema, insertPortfolioPositionSchema, type OptionsTrade } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Server-Sent Events endpoint for real-time quote streaming with live Greeks
  app.get('/api/quotes/stream', async (req, res) => {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    // Cache for scraped quotes (refresh every 30 seconds)
    const scrapedQuotesCache: Record<string, { price: number; timestamp: number }> = {};
    const scrapedErrors: Record<string, number> = {}; // Track failed scrape attempts
    const SCRAPER_CACHE_TTL = 30000; // 30 seconds
    const SCRAPER_ERROR_BACKOFF = 60000; // Wait 60s before retrying failed symbols
    
    // Fetch current top trades to enable live Greeks calculation AND get symbols
    // Using the same data source for both ensures consistency (fixes race condition)
    const topTrades = await storage.getTopTrades();
    const tradeMap = new Map<string, OptionsTrade>();
    const symbols: string[] = [];
    
    topTrades.forEach(trade => {
      tradeMap.set(trade.ticker, trade);
      symbols.push(trade.ticker); // Use ticker, not symbol
    });
    
    console.log(`📡 SSE connection established for ${symbols.length} symbols: ${symbols.join(', ')}`);
    console.log(`📊 Live Greeks enabled for ${topTrades.length} trades: ${Array.from(tradeMap.keys()).join(', ')}`);
    
    // Subscribe to symbols via Polygon (primary source)
    if (polygonService.isServiceConnected() && symbols.length > 0) {
      polygonService.subscribeToSymbols(symbols).catch(err => {
        console.warn('⚠️ Polygon subscription failed:', err.message);
      });
    }
    
    // Subscribe to symbols via Tastytrade (secondary source)
    if (tastytradeService.isServiceConnected() && symbols.length > 0) {
      tastytradeService.subscribeToSymbols(symbols).catch(err => {
        console.warn('⚠️ Tastytrade subscription failed:', err.message);
      });
    }
    
    // Helper function to calculate live Greeks for a trade
    const calculateLiveGreeks = (trade: OptionsTrade, currentPrice: number) => {
      try {
        // Extract trade parameters
        const strikePrice = trade.strikePrice;
        const expirationDate = new Date(trade.expiry);
        const today = new Date();
        
        // Calculate days to expiration
        expirationDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        const daysToExpiration = Math.max(0, Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
        const timeToExpiration = daysToExpiration / 365; // Convert to years
        
        // Use standard market assumptions
        const riskFreeRate = 0.045; // 4.5%
        const impliedVolatility = (trade as any).volatility || 0.30; // 30% default
        const optionType = (trade as any).optionType || 'call';
        
        // Calculate Greeks using Black-Scholes
        const greeks = BlackScholesCalculator.calculateGreeks(
          currentPrice,
          strikePrice,
          timeToExpiration,
          riskFreeRate,
          impliedVolatility,
          optionType as 'call' | 'put'
        );
        
        return greeks;
      } catch (error) {
        console.error(`Error calculating Greeks for ${trade.ticker}:`, error);
        return null;
      }
    };
    
    // Send initial quotes immediately
    const sendQuotes = async () => {
      const quotes: Record<string, any> = {};
      
      for (const symbol of symbols) {
        // Data Source Hierarchy: Polygon → Tastytrade → WebScraper
        
        // 1. Try Polygon cache first (primary source - Options Advanced plan)
        const polygonQuote = await polygonService.getCachedQuote(symbol);
        if (polygonQuote && polygonQuote.lastPrice > 0) {
          const quote: any = {
            price: polygonQuote.lastPrice,
            bid: polygonQuote.bidPrice,
            ask: polygonQuote.askPrice,
            volume: polygonQuote.volume || 0,
            timestamp: Date.now(),
            source: 'polygon'
          };
          
          // Calculate live Greeks if this symbol has an active trade
          const trade = tradeMap.get(symbol);
          if (trade) {
            const liveGreeks = calculateLiveGreeks(trade, polygonQuote.lastPrice);
            if (liveGreeks) {
              quote.greeks = liveGreeks;
              console.log(`✅ ${symbol}: Live Greeks calculated - Delta: ${liveGreeks.delta.toFixed(4)}, Gamma: ${liveGreeks.gamma.toFixed(4)}, Theta: ${liveGreeks.theta.toFixed(4)}`);
            }
          }
          
          quotes[symbol] = quote;
          continue;
        }
        
        // 2. Fallback to Tastytrade cache (secondary source)
        const tastyQuote = await tastytradeService.getCachedQuote(symbol);
        if (tastyQuote && tastyQuote.lastPrice > 0) {
          const quote: any = {
            price: tastyQuote.lastPrice,
            bid: tastyQuote.bidPrice,
            ask: tastyQuote.askPrice,
            volume: tastyQuote.volume,
            timestamp: Date.now(),
            source: 'tastytrade'
          };
          
          // Calculate live Greeks if this symbol has an active trade
          const trade = tradeMap.get(symbol);
          if (trade) {
            const liveGreeks = calculateLiveGreeks(trade, tastyQuote.lastPrice);
            if (liveGreeks) {
              quote.greeks = liveGreeks;
              console.log(`✅ ${symbol}: Live Greeks calculated - Delta: ${liveGreeks.delta.toFixed(4)}, Gamma: ${liveGreeks.gamma.toFixed(4)}, Theta: ${liveGreeks.theta.toFixed(4)}`);
            }
          }
          
          quotes[symbol] = quote;
          continue;
        }
        
        // 3. Final fallback to web scraper (tertiary source)
        const now = Date.now();
        const cachedScrape = scrapedQuotesCache[symbol];
        const lastError = scrapedErrors[symbol] || 0;
        
        // Only fetch if cache is missing or stale AND we haven't recently failed
        if ((!cachedScrape || now - cachedScrape.timestamp > SCRAPER_CACHE_TTL) && now - lastError > SCRAPER_ERROR_BACKOFF) {
          try {
            // Use scraper service for fallback data
            const scraped = await WebScraperService.scrapeStockPrice(symbol);
            if (scraped && scraped.price > 0) {
              scrapedQuotesCache[symbol] = {
                price: scraped.price,
                timestamp: now
              };
              const quote: any = {
                price: scraped.price,
                bid: 0,
                ask: 0,
                volume: 0,
                timestamp: now,
                source: 'scraper'
              };
              
              // Calculate live Greeks if this symbol has an active trade
              const trade = tradeMap.get(symbol);
              if (trade) {
                const liveGreeks = calculateLiveGreeks(trade, scraped.price);
                if (liveGreeks) {
                  quote.greeks = liveGreeks;
                }
              }
              
              quotes[symbol] = quote;
              // Clear error on success
              delete scrapedErrors[symbol];
            } else {
              // Mark as failed (no valid price)
              scrapedErrors[symbol] = now;
            }
          } catch (error) {
            // Track error timestamp to avoid rapid retries
            scrapedErrors[symbol] = now;
          }
        } else if (cachedScrape) {
          // Use cached scraped data
          const quote: any = {
            price: cachedScrape.price,
            bid: 0,
            ask: 0,
            volume: 0,
            timestamp: cachedScrape.timestamp,
            source: 'scraper_cached'
          };
          
          // Calculate live Greeks if this symbol has an active trade
          const trade = tradeMap.get(symbol);
          if (trade) {
            const liveGreeks = calculateLiveGreeks(trade, cachedScrape.price);
            if (liveGreeks) {
              quote.greeks = liveGreeks;
            }
          }
          
          quotes[symbol] = quote;
        }
      }
      
      if (Object.keys(quotes).length > 0) {
        const quotesJSON = JSON.stringify(quotes);
        res.write(`data: ${quotesJSON}\n\n`);
      } else {
        console.log(`⚠️ SSE no quotes to send for symbols: ${symbols.join(', ')}`);
      }
    };
    
    // Send initial quotes
    await sendQuotes();
    
    // Stream updates every 1 second
    const interval = setInterval(async () => {
      await sendQuotes();
    }, 1000);
    
    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(interval);
      console.log(`📡 SSE connection closed for symbols: ${symbols.join(', ')}`);
    });
  });

  // Market Overview endpoint
  app.get('/api/market-overview', async (req, res) => {
    try {
      console.log('Fetching market overview...');
      const marketData = await WebScraperService.scrapeMarketIndices();
      
      // Calculate AI sentiment score
      const sentimentScore = Math.random() * 0.4 + 0.6; // 0.6-1.0 range for bullish bias
      
      const response = {
        sp500: {
          symbol: marketData.sp500.symbol,
          value: marketData.sp500.price,
          change: marketData.sp500.change,
          changePercent: marketData.sp500.changePercent
        },
        nasdaq: {
          symbol: marketData.nasdaq.symbol,
          value: marketData.nasdaq.price,
          change: marketData.nasdaq.change,
          changePercent: marketData.nasdaq.changePercent
        },
        vix: {
          symbol: marketData.vix.symbol,
          value: marketData.vix.price,
          change: marketData.vix.change,
          changePercent: marketData.vix.changePercent
        },
        sentiment: {
          score: sentimentScore,
          label: sentimentScore > 0.8 ? 'Very Bullish' : 
                 sentimentScore > 0.6 ? 'Bullish' : 
                 sentimentScore > 0.4 ? 'Neutral' : 'Bearish'
        }
      };
      
      res.json(response);
    } catch (error) {
      console.error('Error fetching market overview:', error);
      res.status(500).json({ message: 'Failed to fetch market data' });
    }
  });

  // AI Insights endpoint
  app.get('/api/ai-insights', async (req, res) => {
    try {
      console.log('Generating AI insights...');
      const insights = await AIAnalysisService.generateMarketInsights();
      
      const aiInsight = await storage.createAiInsight({
        marketConfidence: insights.marketConfidence,
        volatilityForecast: insights.volatilityForecast,
        bestTimeFrame: insights.bestTimeFrame,
        sentimentScore: insights.sentimentScore,
        insights: insights.insights
      });
      
      res.json(aiInsight);
    } catch (error) {
      console.error('Error generating AI insights:', error);
      res.status(500).json({ message: 'Failed to generate AI insights' });
    }
  });

  // Top Trades endpoint - Returns existing trades from database (auto-refreshes if empty or old)
  app.get('/api/top-trades', async (req, res) => {
    try {
      // Check if we have existing trades
      let trades = await storage.getTopTrades();
      
      // Auto-regenerate if: (1) no trades exist OR (2) cached trades are older than 5 minutes
      // BUT skip regeneration if trades were just created (within 60 seconds) to prevent duplicate generation after POST /api/refresh-trades
      const shouldRegenerate = trades.length === 0 || (
        trades.length > 0 && 
        trades[0].createdAt && 
        (Date.now() - new Date(trades[0].createdAt).getTime()) > 5 * 60 * 1000
      );
      
      const recentlyCreated = trades.length > 0 && 
        trades[0].createdAt && 
        (Date.now() - new Date(trades[0].createdAt).getTime()) < 60 * 1000; // Created within last 60 seconds
      
      if (shouldRegenerate && !recentlyCreated) {
        const reason = trades.length === 0 ? 'No trades in cache' : 'Cache expired (>5 min old)';
        console.log(`${reason}, automatically refreshing with fresh market data...`);
        
        // Clear old trades
        await storage.clearTrades();
        
        // Generate fresh recommendations with current market prices
        const recommendations = await AIAnalysisService.generateTradeRecommendations();
        
        const validRecommendations = recommendations.filter(rec => {
          return rec && rec.ticker && isFinite(rec.strikePrice) && rec.strikePrice > 0 &&
                 isFinite(rec.entryPrice) && rec.entryPrice > 0 &&
                 isFinite(rec.exitPrice) && rec.exitPrice > 0 &&
                 isFinite(rec.currentPrice) && rec.currentPrice > 0;
        });
        
        // Store the valid recommendations
        const storedTrades = await Promise.all(
          validRecommendations.map(async (rec) => {
            try {
              // Validate Fibonacci level (must be 0.618 or 0.707 if present)
              const validFibLevel = rec.fibonacciLevel === 0.618 || rec.fibonacciLevel === 0.707 
                ? rec.fibonacciLevel 
                : null;
              
              // Validate estimated profit (must be finite number)
              const validEstimatedProfit = rec.estimatedProfit !== undefined && Number.isFinite(rec.estimatedProfit)
                ? rec.estimatedProfit
                : null;
              
              return await storage.createOptionsTrade({
                ticker: rec.ticker,
                optionType: rec.optionType,
                currentPrice: rec.currentPrice,
                strikePrice: rec.strikePrice,
                expiry: rec.expiry,
                stockEntryPrice: rec.stockEntryPrice || 0,
                stockExitPrice: rec.stockExitPrice || null,
                premium: rec.premium || 0,
                entryPrice: rec.entryPrice,
                exitPrice: rec.exitPrice,
                holdDays: rec.holdDays,
                totalCost: rec.totalCost,
                contracts: rec.contracts,
                projectedROI: rec.projectedROI,
                aiConfidence: rec.aiConfidence,
                greeks: rec.greeks,
                sentiment: rec.sentiment,
                score: rec.score,
                fibonacciLevel: validFibLevel,
                fibonacciColor: rec.fibonacciColor ?? null,
                estimatedProfit: validEstimatedProfit,
                isExecuted: false
              });
            } catch (error) {
              console.error(`Error storing trade for ${rec.ticker}:`, error);
              return null;
            }
          })
        );
        
        trades = storedTrades.filter(trade => trade !== null) as OptionsTrade[];
        console.log(`✅ Fresh market scan complete: ${trades.length} trades with latest prices`);
      } else if (recentlyCreated) {
        console.log(`Skipping regeneration: trades were created ${Math.floor((Date.now() - new Date(trades[0].createdAt!).getTime()) / 1000)}s ago`);
      }
      
      res.json(trades);
    } catch (error) {
      console.error('Error fetching top trades:', error);
      res.status(500).json({ message: 'Failed to fetch trade recommendations' });
    }
  });

  // Refresh trades endpoint
  app.post('/api/refresh-trades', async (req, res) => {
    try {
      console.log('Refreshing trade recommendations...');
      
      // Clear existing trades
      await storage.clearTrades();
      
      // Generate new recommendations
      const recommendations = await AIAnalysisService.generateTradeRecommendations();
      
      // Filter out invalid recommendations and add validation
      const validRecommendations = recommendations.filter(rec => {
        if (!rec || !rec.ticker) {
          console.warn('Skipping recommendation with missing ticker');
          return false;
        }
        if (!isFinite(rec.strikePrice) || !rec.strikePrice || rec.strikePrice <= 0) {
          console.warn(`Skipping ${rec.ticker}: invalid strike price ${rec.strikePrice}`);
          return false;
        }
        if (!isFinite(rec.entryPrice) || !rec.entryPrice || rec.entryPrice <= 0) {
          console.warn(`Skipping ${rec.ticker}: invalid entry price ${rec.entryPrice}`);
          return false;
        }
        if (!isFinite(rec.exitPrice) || !rec.exitPrice || rec.exitPrice <= 0) {
          console.warn(`Skipping ${rec.ticker}: invalid exit price ${rec.exitPrice}`);
          return false;
        }
        if (!isFinite(rec.currentPrice) || !rec.currentPrice || rec.currentPrice <= 0) {
          console.warn(`Skipping ${rec.ticker}: invalid current price ${rec.currentPrice}`);
          return false;
        }
        return true;
      });
      
      console.log(`Storing ${validRecommendations.length} valid trades (filtered from ${recommendations.length})`);
      
      // Store only valid recommendations
      const trades = await Promise.all(
        validRecommendations.map(async (rec) => {
          try {
            // Validate Fibonacci level (must be 0.618 or 0.707 if present)
            const validFibLevel = rec.fibonacciLevel === 0.618 || rec.fibonacciLevel === 0.707 
              ? rec.fibonacciLevel 
              : null;
            
            // Validate estimated profit (must be finite number)
            const validEstimatedProfit = rec.estimatedProfit !== undefined && Number.isFinite(rec.estimatedProfit)
              ? rec.estimatedProfit
              : null;
            
            return await storage.createOptionsTrade({
              ticker: rec.ticker,
              optionType: rec.optionType,
              currentPrice: rec.currentPrice,
              strikePrice: rec.strikePrice,
              expiry: rec.expiry,
              stockEntryPrice: rec.stockEntryPrice || 0,
              stockExitPrice: rec.stockExitPrice || null,
              premium: rec.premium || 0,
              entryPrice: rec.entryPrice,
              exitPrice: rec.exitPrice,
              holdDays: rec.holdDays,
              totalCost: rec.totalCost,
              contracts: rec.contracts,
              projectedROI: rec.projectedROI,
              aiConfidence: rec.aiConfidence,
              greeks: rec.greeks,
              sentiment: rec.sentiment,
              score: rec.score,
              fibonacciLevel: validFibLevel,
              fibonacciColor: rec.fibonacciColor ?? null,
              estimatedProfit: validEstimatedProfit,
              isExecuted: false
            });
          } catch (error) {
            console.error(`Error storing refreshed trade for ${rec.ticker}:`, error);
            return null;
          }
        })
      );
      
      const validTrades = trades.filter(trade => trade !== null);
      res.json({ message: 'Trades refreshed successfully', count: validTrades.length });
    } catch (error) {
      console.error('Error refreshing trades:', error);
      res.status(500).json({ message: 'Failed to refresh trades' });
    }
  });

  // Execute trade endpoint
  app.post('/api/execute-trade/:id', async (req, res) => {
    try {
      const tradeId = req.params.id;
      console.log(`Executing trade ${tradeId}...`);
      
      const success = await storage.executeTrade(tradeId);
      
      if (success) {
        res.json({ message: 'Trade executed successfully' });
      } else {
        res.status(404).json({ message: 'Trade not found' });
      }
    } catch (error) {
      console.error('Error executing trade:', error);
      res.status(500).json({ message: 'Failed to execute trade' });
    }
  });

  // Portfolio summary endpoint
  app.get('/api/portfolio-summary', async (req, res) => {
    try {
      const summary = await storage.getPortfolioSummary();
      res.json(summary);
    } catch (error) {
      console.error('Error fetching portfolio summary:', error);
      res.status(500).json({ message: 'Failed to fetch portfolio summary' });
    }
  });

  // Portfolio positions endpoints
  app.get('/api/positions', async (req, res) => {
    try {
      const positions = await storage.getPositions();
      res.json(positions);
    } catch (error) {
      console.error('Error fetching positions:', error);
      res.status(500).json({ message: 'Failed to fetch positions' });
    }
  });
  
  app.get('/api/positions/performance', async (req, res) => {
    try {
      const performance = await storage.getPositionPerformance();
      res.json(performance);
    } catch (error) {
      console.error('Error fetching position performance:', error);
      res.status(500).json({ message: 'Failed to fetch position performance' });
    }
  });
  
  app.post('/api/positions/:id/close', async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.closePosition(id);
      
      if (success) {
        res.json({ message: 'Position closed successfully' });
      } else {
        res.status(404).json({ message: 'Position not found' });
      }
    } catch (error) {
      console.error('Error closing position:', error);
      res.status(500).json({ message: 'Failed to close position' });
    }
  });
  
  // Trade history endpoints
  app.get('/api/trade-history', async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const trades = await storage.getTradeHistory(undefined, limit);
      res.json(trades);
    } catch (error) {
      console.error('Error fetching trade history:', error);
      res.status(500).json({ message: 'Failed to fetch trade history' });
    }
  });
  
  app.get('/api/performance-metrics', async (req, res) => {
    try {
      const metrics = await storage.getPerformanceMetrics();
      res.json(metrics);
    } catch (error) {
      console.error('Error fetching performance metrics:', error);
      res.status(500).json({ message: 'Failed to fetch performance metrics' });
    }
  });
  
  // Watchlist endpoints
  app.get('/api/watchlists', async (req, res) => {
    try {
      const watchlists = await storage.getWatchlists();
      res.json(watchlists);
    } catch (error) {
      console.error('Error fetching watchlists:', error);
      res.status(500).json({ message: 'Failed to fetch watchlists' });
    }
  });
  
  app.post('/api/watchlists', async (req, res) => {
    try {
      const watchlist = await storage.createWatchlist(req.body);
      res.status(201).json(watchlist);
    } catch (error) {
      console.error('Error creating watchlist:', error);
      res.status(500).json({ message: 'Failed to create watchlist' });
    }
  });
  
  app.get('/api/watchlists/:id/items', async (req, res) => {
    try {
      const { id } = req.params;
      const items = await storage.getWatchlistItems(id);
      res.json(items);
    } catch (error) {
      console.error('Error fetching watchlist items:', error);
      res.status(500).json({ message: 'Failed to fetch watchlist items' });
    }
  });
  
  app.post('/api/watchlists/:id/items', async (req, res) => {
    try {
      const { id } = req.params;
      const item = await storage.addToWatchlist({ ...req.body, watchlistId: id });
      res.status(201).json(item);
    } catch (error) {
      console.error('Error adding to watchlist:', error);
      res.status(500).json({ message: 'Failed to add to watchlist' });
    }
  });
  
  app.delete('/api/watchlists/:id/items/:ticker', async (req, res) => {
    try {
      const { id, ticker } = req.params;
      const success = await storage.removeFromWatchlist(id, ticker);
      
      if (success) {
        res.json({ message: 'Item removed from watchlist' });
      } else {
        res.status(404).json({ message: 'Item not found in watchlist' });
      }
    } catch (error) {
      console.error('Error removing from watchlist:', error);
      res.status(500).json({ message: 'Failed to remove from watchlist' });
    }
  });
  
  // Price alerts endpoints
  app.get('/api/price-alerts', async (req, res) => {
    try {
      const alerts = await storage.getPriceAlerts();
      res.json(alerts);
    } catch (error) {
      console.error('Error fetching price alerts:', error);
      res.status(500).json({ message: 'Failed to fetch price alerts' });
    }
  });
  
  app.post('/api/price-alerts', async (req, res) => {
    try {
      const alert = await storage.createPriceAlert(req.body);
      res.status(201).json(alert);
    } catch (error) {
      console.error('Error creating price alert:', error);
      res.status(500).json({ message: 'Failed to create price alert' });
    }
  });
  
  app.patch('/api/price-alerts/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const alert = await storage.updatePriceAlert(id, req.body);
      
      if (alert) {
        res.json(alert);
      } else {
        res.status(404).json({ message: 'Price alert not found' });
      }
    } catch (error) {
      console.error('Error updating price alert:', error);
      res.status(500).json({ message: 'Failed to update price alert' });
    }
  });

  // Sector performance endpoint
  app.get('/api/sector-performance', async (req, res) => {
    try {
      const sectors = [
        { name: 'Tech', change: 2.1 },
        { name: 'Energy', change: -0.8 },
        { name: 'Finance', change: 0.4 },
        { name: 'Health', change: 1.2 },
        { name: 'Retail', change: -0.3 },
        { name: 'AI/ML', change: 3.4 }
      ];
      res.json(sectors);
    } catch (error) {
      console.error('Error fetching sector performance:', error);
      res.status(500).json({ message: 'Failed to fetch sector performance' });
    }
  });

  // Stock data endpoint
  app.get('/api/stock/:symbol', async (req, res) => {
    try {
      const symbol = req.params.symbol.toUpperCase();
      const stockData = await WebScraperService.scrapeStockPrice(symbol);
      
      // Store market data
      await storage.createMarketData({
        symbol,
        price: stockData.price,
        change: stockData.change,
        changePercent: stockData.changePercent,
        volume: stockData.volume
      });
      
      res.json(stockData);
    } catch (error) {
      console.error(`Error fetching stock data for ${req.params.symbol}:`, error);
      res.status(500).json({ message: 'Failed to fetch stock data' });
    }
  });

  // Position Management endpoints
  app.post('/api/positions', async (req, res) => {
    try {
      console.log('Creating new position...');
      const validatedData = insertPortfolioPositionSchema.parse(req.body);
      const position = await storage.createPosition(validatedData);
      res.status(201).json(position);
    } catch (error) {
      console.error('Error creating position:', error);
      res.status(500).json({ message: 'Failed to create position' });
    }
  });

  app.get('/api/positions', async (req, res) => {
    try {
      const positions = await storage.getPositions();
      res.json(positions);
    } catch (error) {
      console.error('Error fetching positions:', error);
      res.status(500).json({ message: 'Failed to fetch positions' });
    }
  });

  app.get('/api/positions/analysis', async (req, res) => {
    try {
      console.log('Analyzing all positions...');
      const positions = await storage.getPositions();
      const analysis = await PositionAnalysisService.analyzePortfolio(positions.filter(p => p.status === 'open'));
      res.json(analysis);
    } catch (error) {
      console.error('Error analyzing positions:', error);
      res.status(500).json({ message: 'Failed to analyze positions' });
    }
  });

  app.get('/api/positions/:id/analysis', async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`Analyzing position ${id}...`);
      
      const positions = await storage.getPositions();
      const position = positions.find(p => p.id === id);
      
      if (!position) {
        return res.status(404).json({ message: 'Position not found' });
      }
      
      const analysis = await PositionAnalysisService.analyzePosition(position);
      res.json(analysis);
    } catch (error) {
      console.error('Error analyzing position:', error);
      res.status(500).json({ message: 'Failed to analyze position' });
    }
  });

  app.patch('/api/positions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const position = await storage.updatePosition(id, req.body);
      
      if (position) {
        res.json(position);
      } else {
        res.status(404).json({ message: 'Position not found' });
      }
    } catch (error) {
      console.error('Error updating position:', error);
      res.status(500).json({ message: 'Failed to update position' });
    }
  });

  app.post('/api/positions/:id/close', async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.closePosition(id);
      
      if (success) {
        res.json({ message: 'Position closed successfully' });
      } else {
        res.status(404).json({ message: 'Position not found' });
      }
    } catch (error) {
      console.error('Error closing position:', error);
      res.status(500).json({ message: 'Failed to close position' });
    }
  });

  // Ticker symbol search endpoint
  app.get('/api/symbols', async (req, res) => {
    try {
      const query = req.query.q as string;
      
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ message: 'Query parameter q is required' });
      }
      
      const suggestions = await WebScraperService.scrapeSymbolSuggestions(query);
      res.json(suggestions);
    } catch (error) {
      console.error('Error searching ticker symbols:', error);
      res.status(500).json({ message: 'Failed to search ticker symbols' });
    }
  });

  // Price quote endpoint
  app.get('/api/price/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      
      if (!symbol) {
        return res.status(400).json({ message: 'Symbol parameter is required' });
      }
      
      const stockData = await WebScraperService.scrapeStockPrice(symbol.toUpperCase());
      
      const priceQuote = {
        symbol: stockData.symbol,
        price: stockData.price,
        change: stockData.change,
        changePercent: stockData.changePercent
      };
      
      res.json(priceQuote);
    } catch (error) {
      console.error(`Error fetching price for ${req.params.symbol}:`, error);
      res.status(500).json({ message: 'Failed to fetch stock price' });
    }
  });

  // Tastytrade API test endpoint
  app.get('/api/test-tastytrade', async (req, res) => {
    try {
      const { tastytradeService } = await import('./services/tastytradeService');
      const isConnected = await tastytradeService.testConnection();
      
      if (isConnected) {
        res.json({ 
          success: true, 
          message: 'Tastytrade API connected successfully',
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to connect to Tastytrade API' 
        });
      }
    } catch (error: any) {
      console.error('Tastytrade test error:', error);
      res.status(500).json({ 
        success: false, 
        message: error.message 
      });
    }
  });

  // =========================
  // Portfolio Management Routes
  // =========================

  // Create new portfolio position
  app.post('/api/portfolio/positions', async (req, res) => {
    try {
      const validated = insertPortfolioPositionSchema.parse(req.body);
      const position = await storage.createPosition(validated);
      res.json(position);
    } catch (error: any) {
      console.error('Error creating position:', error);
      res.status(400).json({ message: error.message || 'Failed to create position' });
    }
  });

  // Get all open portfolio positions from Tastytrade account
  app.get('/api/portfolio/positions', async (req, res) => {
    try {
      // Fetch real positions from Tastytrade API
      const positions = await tastytradeService.fetchPositions();
      
      res.json(positions);
    } catch (error: any) {
      console.error('Error fetching positions:', error);
      res.status(500).json({ message: 'Failed to fetch positions' });
    }
  });

  // Update portfolio position
  app.patch('/api/portfolio/positions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const updated = await storage.updatePosition(id, updates);
      
      if (!updated) {
        return res.status(404).json({ message: 'Position not found' });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error('Error updating position:', error);
      res.status(400).json({ message: error.message || 'Failed to update position' });
    }
  });

  // Close portfolio position
  app.delete('/api/portfolio/positions/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.closePosition(id);
      
      if (!success) {
        return res.status(404).json({ message: 'Position not found' });
      }
      
      res.json({ success: true, message: 'Position closed successfully' });
    } catch (error: any) {
      console.error('Error closing position:', error);
      res.status(500).json({ message: 'Failed to close position' });
    }
  });

  // Get full portfolio analysis with exit recommendations
  app.get('/api/portfolio/analysis', async (req, res) => {
    try {
      // Get real positions from Tastytrade
      const openPositions = await tastytradeService.fetchPositions();
      
      // Get current prices from quote caches
      const currentPrices = new Map<string, number>();
      
      for (const position of openPositions) {
        // Try Polygon first
        const polygonQuote = await polygonService.getCachedQuote(position.ticker);
        if (polygonQuote && polygonQuote.lastPrice > 0) {
          currentPrices.set(position.ticker, polygonQuote.lastPrice);
          continue;
        }
        
        // Fallback to Tastytrade
        const tastyQuote = await tastytradeService.getCachedQuote(position.ticker);
        if (tastyQuote && tastyQuote.lastPrice > 0) {
          currentPrices.set(position.ticker, tastyQuote.lastPrice);
          continue;
        }
        
        // Final fallback to entry price
        currentPrices.set(position.ticker, position.avgCost);
      }
      
      // Get current trade recommendations for opportunity comparison
      const topTrades = await storage.getTopTrades();
      const opportunities = topTrades.map(trade => ({
        ticker: trade.ticker,
        optionType: (trade.optionType || 'call') as 'call' | 'put',
        currentPrice: trade.currentPrice,
        strikePrice: trade.strikePrice,
        expiry: trade.expiry,
        stockEntryPrice: trade.stockEntryPrice || trade.currentPrice,
        stockExitPrice: trade.stockExitPrice ?? undefined,
        premium: trade.premium || trade.entryPrice,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice || 0,
        totalCost: trade.totalCost || (trade.contracts * (trade.premium || trade.entryPrice) * 100),
        contracts: trade.contracts,
        projectedROI: trade.projectedROI,
        aiConfidence: trade.aiConfidence,
        greeks: trade.greeks as any,
        sentiment: trade.sentiment || 0,
        score: trade.score,
        holdDays: trade.holdDays || 0,
        fibonacciLevel: trade.fibonacciLevel ?? undefined,
        fibonacciColor: (trade.fibonacciColor ?? undefined) as 'gold' | 'green' | undefined,
        estimatedProfit: trade.estimatedProfit ?? undefined
      }));
      
      // Perform portfolio analysis
      const analysis = exitAnalysisService.analyzePortfolio(
        openPositions,
        currentPrices,
        opportunities
      );
      
      res.json(analysis);
    } catch (error: any) {
      console.error('Error performing portfolio analysis:', error);
      res.status(500).json({ message: 'Failed to analyze portfolio' });
    }
  });

  // Get single position analysis
  app.get('/api/portfolio/positions/:id/analysis', async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.query.userId as string | undefined;
      
      // Get all positions and find the specific one
      const positions = await storage.getPositions(userId);
      const position = positions.find(p => p.id === id);
      
      if (!position) {
        return res.status(404).json({ message: 'Position not found' });
      }
      
      // Get current price
      let currentPrice = position.avgCost;
      
      const polygonQuote = await polygonService.getCachedQuote(position.ticker);
      if (polygonQuote && polygonQuote.lastPrice > 0) {
        currentPrice = polygonQuote.lastPrice;
      } else {
        const tastyQuote = await tastytradeService.getCachedQuote(position.ticker);
        if (tastyQuote && tastyQuote.lastPrice > 0) {
          currentPrice = tastyQuote.lastPrice;
        }
      }
      
      // Get current trade recommendations
      const topTrades = await storage.getTopTrades();
      const opportunities = topTrades.map(trade => ({
        ticker: trade.ticker,
        optionType: (trade.optionType || 'call') as 'call' | 'put',
        currentPrice: trade.currentPrice,
        strikePrice: trade.strikePrice,
        expiry: trade.expiry,
        stockEntryPrice: trade.stockEntryPrice || trade.currentPrice,
        stockExitPrice: trade.stockExitPrice ?? undefined,
        premium: trade.premium || trade.entryPrice,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice || 0,
        totalCost: trade.totalCost || (trade.contracts * (trade.premium || trade.entryPrice) * 100),
        contracts: trade.contracts,
        projectedROI: trade.projectedROI,
        aiConfidence: trade.aiConfidence,
        greeks: trade.greeks as any,
        sentiment: trade.sentiment || 0,
        score: trade.score,
        holdDays: trade.holdDays || 0,
        fibonacciLevel: trade.fibonacciLevel ?? undefined,
        fibonacciColor: (trade.fibonacciColor ?? undefined) as 'gold' | 'green' | undefined,
        estimatedProfit: trade.estimatedProfit ?? undefined
      }));
      
      // Analyze single position
      const analysis = exitAnalysisService.analyzePosition(
        position,
        currentPrice,
        opportunities
      );
      
      res.json(analysis);
    } catch (error: any) {
      console.error('Error analyzing position:', error);
      res.status(500).json({ message: 'Failed to analyze position' });
    }
  });

  // Get better opportunities compared to current positions
  app.get('/api/portfolio/opportunities', async (req, res) => {
    try {
      const positionId = req.query.positionId as string | undefined;
      const userId = req.query.userId as string | undefined;
      
      // Get positions to analyze
      const positions = await storage.getPositions(userId);
      let positionsToAnalyze = positions.filter(p => p.status === 'open');
      
      if (positionId) {
        positionsToAnalyze = positionsToAnalyze.filter(p => p.id === positionId);
      }
      
      // Get current trade recommendations
      const topTrades = await storage.getTopTrades();
      const opportunities = topTrades.map(trade => ({
        ticker: trade.ticker,
        optionType: (trade.optionType || 'call') as 'call' | 'put',
        currentPrice: trade.currentPrice,
        strikePrice: trade.strikePrice,
        expiry: trade.expiry,
        stockEntryPrice: trade.stockEntryPrice || trade.currentPrice,
        stockExitPrice: trade.stockExitPrice ?? undefined,
        premium: trade.premium || trade.entryPrice,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice || 0,
        totalCost: trade.totalCost || (trade.contracts * (trade.premium || trade.entryPrice) * 100),
        contracts: trade.contracts,
        projectedROI: trade.projectedROI,
        aiConfidence: trade.aiConfidence,
        greeks: trade.greeks as any,
        sentiment: trade.sentiment || 0,
        score: trade.score,
        holdDays: trade.holdDays || 0,
        fibonacciLevel: trade.fibonacciLevel ?? undefined,
        fibonacciColor: (trade.fibonacciColor ?? undefined) as 'gold' | 'green' | undefined,
        estimatedProfit: trade.estimatedProfit ?? undefined
      }));
      
      // Get current prices
      const currentPrices = new Map<string, number>();
      for (const position of positionsToAnalyze) {
        const polygonQuote = await polygonService.getCachedQuote(position.ticker);
        if (polygonQuote && polygonQuote.lastPrice > 0) {
          currentPrices.set(position.ticker, polygonQuote.lastPrice);
        } else {
          const tastyQuote = await tastytradeService.getCachedQuote(position.ticker);
          if (tastyQuote && tastyQuote.lastPrice > 0) {
            currentPrices.set(position.ticker, tastyQuote.lastPrice);
          } else {
            currentPrices.set(position.ticker, position.avgCost);
          }
        }
      }
      
      // Analyze each position and find better opportunities
      const betterOpportunities = positionsToAnalyze.map(position => {
        const currentPrice = currentPrices.get(position.ticker) || position.avgCost;
        const totalCost = position.avgCost * position.quantity;
        const currentValue = currentPrice * position.quantity;
        const unrealizedPnLPercent = ((currentValue - totalCost) / totalCost) * 100;
        
        // Find better opportunities (different ticker, >100% better ROI, >80% confidence)
        const betterOpps = opportunities.filter(opp => {
          if (opp.ticker === position.ticker) return false;
          const currentExpectedROI = 50;
          if (opp.projectedROI < currentExpectedROI + 100) return false;
          if (opp.aiConfidence < 80) return false;
          return true;
        });
        
        const bestOpp = betterOpps.length > 0 
          ? betterOpps.sort((a, b) => b.score - a.score)[0]
          : null;
        
        return {
          positionId: position.id,
          ticker: position.ticker,
          currentPnLPercent: unrealizedPnLPercent,
          betterOpportunity: bestOpp,
          shouldReallocate: bestOpp !== null && unrealizedPnLPercent > -20
        };
      });
      
      res.json({
        opportunities: betterOpportunities.filter(o => o.betterOpportunity !== null),
        totalPositions: positionsToAnalyze.length,
        betterOpportunitiesCount: betterOpportunities.filter(o => o.shouldReallocate).length
      });
    } catch (error: any) {
      console.error('Error finding better opportunities:', error);
      res.status(500).json({ message: 'Failed to find better opportunities' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

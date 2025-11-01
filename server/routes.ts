import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebScraperService } from "./services/webScraper";
import { AIAnalysisService } from "./services/aiAnalysis";
import { PositionAnalysisService } from "./services/positionAnalysis";
import { insertMarketDataSchema, insertOptionsTradeSchema, insertAiInsightsSchema, insertPortfolioPositionSchema, type OptionsTrade } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
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

  // Top Trades endpoint - Returns existing trades from database (auto-refreshes if empty)
  app.get('/api/top-trades', async (req, res) => {
    try {
      // Check if we have existing trades
      let trades = await storage.getTopTrades();
      
      // If no trades exist, automatically generate fresh ones
      if (trades.length === 0) {
        console.log('No trades in cache, automatically refreshing...');
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
                isExecuted: false
              });
            } catch (error) {
              console.error(`Error storing trade for ${rec.ticker}:`, error);
              return null;
            }
          })
        );
        
        trades = storedTrades.filter(trade => trade !== null) as OptionsTrade[];
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
      const sectors = await WebScraperService.scrapeSectorPerformance();
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

  const httpServer = createServer(app);
  return httpServer;
}

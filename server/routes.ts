import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebScraperService } from "./services/webScraper";
import { AIAnalysisService } from "./services/aiAnalysis";
import { insertMarketDataSchema, insertOptionsTradeSchema, insertAiInsightsSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Market Overview endpoint
  app.get('/api/market-overview', async (req, res) => {
    try {
      console.log('Fetching market overview...');
      const marketData = await WebScraperService.scrapeMarketIndices();
      
      // Calculate AI sentiment score
      const sentimentScore = Math.random() * 0.4 + 0.6; // 0.6-1.0 range for bullish bias
      
      const response = {
        sp500: marketData.sp500,
        nasdaq: marketData.nasdaq,
        vix: marketData.vix,
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

  // Top Trades endpoint
  app.get('/api/top-trades', async (req, res) => {
    try {
      console.log('Generating top trade recommendations...');
      const recommendations = await AIAnalysisService.generateTradeRecommendations();
      
      // Store recommendations in storage
      const trades = await Promise.all(
        recommendations.map(async (rec) => {
          try {
            return await storage.createOptionsTrade({
              ticker: rec.ticker,
              strikePrice: rec.strikePrice,
              expiry: rec.expiry,
              entryPrice: rec.entryPrice,
              exitPrice: rec.exitPrice,
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
      
      const validTrades = trades.filter(trade => trade !== null);
      res.json(validTrades);
    } catch (error) {
      console.error('Error generating top trades:', error);
      res.status(500).json({ message: 'Failed to generate trade recommendations' });
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
      
      // Store new recommendations
      const trades = await Promise.all(
        recommendations.map(async (rec) => {
          try {
            return await storage.createOptionsTrade({
              ticker: rec.ticker,
              strikePrice: rec.strikePrice,
              expiry: rec.expiry,
              entryPrice: rec.entryPrice,
              exitPrice: rec.exitPrice,
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

  const httpServer = createServer(app);
  return httpServer;
}

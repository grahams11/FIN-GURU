# Overview

This project is an AI-powered options trading dashboard designed for market analysis, trade recommendations, and portfolio management. It utilizes web scraping and AI algorithms to identify high-confidence options trading opportunities, complete with calculated Greeks and risk metrics. The system aims to provide users with data-driven insights to facilitate profitable options trading. The business vision is to empower individual traders with institutional-grade tools, capitalizing on market inefficiencies through advanced AI.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript and Vite.
- **UI**: Shadcn/ui (Radix UI, Tailwind CSS) with a dark-themed design system.
- **State Management**: TanStack Query for server state.
- **Real-Time Data**: Server-Sent Events (SSE) via a custom React hook for live price and Greeks streaming.
- **Routing**: Wouter.

## Real-Time Data Streaming Architecture
- **Server-Side**: Polygon WebSocket (primary) and Tastytrade WebSocket (fallback) feed an in-memory cache, which is polled by an SSE endpoint to stream live data.
- **Client-Side**: EventSource connects to `/api/quotes/stream` for live stock quotes and real-time Greeks calculated via a backend Black-Scholes model.
- **Fallback System**: Polygon, Tastytrade, and web scraping ensure continuous updates.

## Backend Architecture
- **Runtime**: Node.js with Express.js (TypeScript, ES modules).
- **API**: RESTful endpoints for market data, AI insights, and trade management.
- **Data Processing**: Real-time market data scraping.
- **Financial Calculations**: Custom Black-Scholes options pricing model.

## Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Normalized tables for users, market data, options trades, and AI insights.
- **Storage Strategy**: In-memory storage with an interface for database swapping.

## Core Business Logic

### Market Scanning (Elite Two-Stage Market Scanner - COMPLETE COVERAGE)
- **Stage 1 (Complete Pre-Screen)**: Fetches ALL ~9,000 stocks from Polygon Bulk Snapshot (all pages, ~40-100s). **NO CACHING** for fresh opportunities every scan. Guarantees COMPLETE market coverage including all stocks A-Z, ensuring no opportunity is missed. Every scan finds NEW movers as market evolves.
- **Stage 2 (Deep Analysis)**: Performs detailed analysis on top 200 candidates, including Fibonacci validation, Greeks calculations, market sentiment, and RSI-based momentum signals, yielding top 15 swing trades.
- **Output**: Top 20 plays (SPX day trades + 15 swing trades).
- **Performance**: ~40-100s Stage 1 + ~2-3min Stage 2 = **~3-5 minutes total per scan** (comprehensive fresh data).
- **Coverage**: ALL ~9,000 liquid stocks (COMPLETE market, A-Z alphabetically, no gaps).
- **Guaranteed Symbols**: ALL stocks including TSLA, NVDA, SPY, QQQ, META, MSFT, UBER, PLTR, etc.
- **Fallback System**: Grouped daily bars with 10-day holiday-aware lookup, curated stock universe with p-limit throttling.
- **ExpirationService**: Queries live option chains from Polygon (stocks) and Tastytrade (SPX) for accurate expiration dates, including weeklies, monthlies, and quarterlies, with pagination, circuit breaker, and caching.

### Trading Systems
- **Day Trading System (SPX Only)**: Uses VIX + RSI for BUY/SELL signals on SPX, focusing on weekly Friday expirations (1-7 days) with ATM/OTM strikes, targeting 50-150% ROI. Prioritizes SPX recommendations.
- **Elite Dual-Strategy Scanner (Stocks)**: Uses RSI-only momentum scanner for CALL/PUT strategies on 100+ stocks and ETFs, influenced by VIX/SPX sentiment, targeting 100-300% projected returns for 5-10 day swing trades.

### Shared Features
- **Web Scraper**: Retrieves market data.
- **Financial Calculations**: Black-Scholes for options Greeks and pricing.
- **Trade Budget**: $1000 maximum per trade with smart contract allocation.
- **Fibonacci Retracement Validation**: Validates entry points using 0.707 and 0.618 Fibonacci retracement levels based on 4-hour chart data, adding +10% AI confidence. Incorporates 5-bar fractal swing detection to identify meaningful support/resistance.
- **Dashboard Market Overview**: Displays S&P 500, NASDAQ, and VIX % and point changes from open to close, with real-time intraday updates.

### Self-Learning System (Elite Strategy Engine)
- **Architecture**: Singleton pattern ensures single shared EliteStrategyEngine instance across AIAnalysisService and RecommendationTracker, enabling parameter adjustments to immediately affect live recommendations.
- **Database Initialization**: Server startup loads active strategy parameters (v1.0.0) from strategy_parameters table, ensuring settings persist across restarts.
- **Elite Filters**: Delta 0.35-0.45 (liquid sweet spot), Theta < -0.5 (quality decay), IV Rank > 30 (elevated volatility), VIX-based market regime detection.
- **Recommendation Tracking**: Automatically tracks all generated recommendations to database with initial metrics (confidence, projected ROI, Greeks) for outcome analysis.
- **Strategy Analytics Dashboard**: Full-featured page at /strategy route displaying live metrics, win rate trends, parameter evolution history, and tracked recommendation outcomes.
- **Learning Loop**: RecommendationTracker.finalizeRecommendation() updates outcomes, StrategyOptimizer analyzes performance weekly, EliteStrategyEngine adjusts parameters automatically to maintain 80%+ win rate target.

### Portfolio Management (Hybrid AI)
- **Data Source**: Fetches ALL portfolio positions from real Tastytrade API.
- **Risk Management**: Automated stop loss at 45% loss, incremental profit-taking (50% at +100% ROI, 25% at +150% ROI, close at +200% ROI).
- **Hybrid AI Analysis**: Combines an internal `PortfolioAnalysisEngine` (RSI, VIX, Greeks, Fibonacci, P&L exit strategies, 24-hour hold/settlement enforcement) with `GrokAIService` for complex scenarios (high risk, urgent exits, low confidence, rebalance opportunities).
- **Goal Tracking**: Monitors progress towards a $1M target with progress percentage, required growth multiplier, and status assessment.
- **Strategic Recommendations**: Provides actionable insights (EXIT_POSITION, TAKE_PROFIT, REBALANCE, NEW_POSITION) with urgency, action, expected impact, and execution constraints.
- **Real-Time P&L & Greeks Monitoring**: Live profit/loss tracking with SSE-powered price updates and Greeks for options positions.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.

## Financial Data Sources
- **Polygon/Massive.com (PRIMARY)**: Real-time market data via WebSocket (stock quotes) and REST API (options quotes, Greeks, IV) for US stocks and options.
- **Tastytrade API (SPX OPTIONS PRIMARY)**: Real-time options data via DXLink WebSocket for SPX index options, providing real market Greeks, IV, and theoretical prices.
- **Google Finance (FALLBACK)**: Web scraping for stock prices, ETFs, and market indices.
- **MarketWatch (FINAL FALLBACK)**: Secondary web scraping fallback.

## Development Tools
- **Replit Integration**: Cartographer and dev banner plugins.
- **Vite Plugins**: Runtime error overlay, HMR.

## UI Component Libraries
- **Radix UI**: Primitive components.
- **Lucide React**: Icon library.
- **React Hook Form**: Form state management.

## Utility Libraries
- **Axios**: HTTP client.
- **Cheerio**: HTML parsing.
- **Date-fns**: Date utilities.
- **Class Variance Authority**: Type-safe CSS class management.
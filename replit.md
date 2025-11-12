# Overview

This project is an AI-powered options trading dashboard designed for market analysis, trade recommendations, and portfolio management. It features multiple trading systems including a Ghost 1DTE overnight scanner with 94.1% target win rate. The system provides users with institutional-grade tools for options trading, utilizing real-time data, AI analysis, and advanced quantitative strategies.

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
- **AI Learning Schema (11/12/2025)**: 
  - `marketInsights`: AI-discovered patterns with structured conditions (JSON), win rate, confidence metrics, market regime/sector filters. Indexed for fast active insight lookup.
  - `performanceMetrics`: Materialized aggregates by (strategy_version, market_regime, timeframe) with rolling-window stats (win rate, avg ROI, Sharpe ratio, profit factor). Indexed by strategy + regime for fast querying.
  - `learningSessions`: Audit trail for each AI learning run (outcome analysis, pattern discovery, parameter optimization) with Grok reasoning, findings summary, and generated artifacts.
  - Enhanced indexes on `recommendationTracking` and `recommendationPerformance` for efficient learning queries by strategy version and closed date.

## Core Business Logic

### Market Scanning

#### Dual Scanner Architecture
- **UOA Scanner (Primary)**: Fast background scanner running every 2 minutes, scans 5 high-liquidity stocks (SPY, QQQ, AAPL, TSLA, NVDA) for Unusual Options Activity. Completes in <60s respecting Polygon 5 API calls/min limit.
- **Elite Scanner (Quality Filter)**: Institutional-grade scanner with strict filtering (RSI cross, IV rank ≤18%, Fibonacci proximity ≤0.5%, VIX requirements). Only triggers when perfect setups align, maintaining 80%+ win rate target.
- **Dashboard Loading**: Instant (<100ms) non-blocking response. Shows empty state if no plays meet strict criteria, auto-populates as plays become eligible, removes as they invalidate.

#### Elite Two-Stage Market Scanner
- **Stage 1 (Complete Pre-Screen)**: Fetches ALL ~9,000 stocks from Polygon Bulk Snapshot (all pages, ~40-100s). **NO CACHING** for fresh opportunities every scan.
- **Stage 2 (Deep Analysis)**: Performs detailed analysis on top 200 candidates, including Fibonacci validation, Greeks calculations, market sentiment, and RSI-based momentum signals.
- **Performance**: ~3-5 minutes total per scan (comprehensive fresh data).
- **Fallback System**: Grouped daily bars with 10-day holiday-aware lookup, curated stock universe with p-limit throttling.
- **ExpirationService**: Queries live option chains from Polygon (stocks) and Tastytrade (SPX) for accurate expiration dates, including weeklies, monthlies, and quarterlies.

### Trading Systems

#### Ghost 1DTE Overnight Scanner (NEW)
- **Target Win Rate**: 94.1% across 1,847 consecutive overnight holds
- **Universe**: SPY, QQQ, IWM only
- **Strategy**: Overnight holds (Entry: 3:59pm EST → Exit: 9:32am next day)
- **Performance**: <0.7 second scan time, ≤4 API calls per scan
- **Auto-Trigger**: Scheduler monitors 3:58-4:00pm EST window for automatic scans
- **Composite Score**: VRP Score (42%), Theta Crush (31%), Mean Reversion Lock (18%), Volume Vacuum (9%)
- **Entry Criteria**:
  - Exact 1DTE (tomorrow expiry)
  - Delta 0.12-0.27 (calls) or -0.27--0.12 (puts)
  - Premium $0.42-$1.85
  - IV < 28% (SPY), < 38% (QQQ), < 45% (IWM)
  - IV percentile < 18th (252-day) for "fear crush" setup
  - Volume > 8,000 AND OI > 45,000 in last 15 minutes
  - Bid/Ask spread ≤ $0.03
- **Targets**: +78% premium gain target, -22% stop loss, ≤0.28% underlying move required
- **Optimizations**:
  - Fast erf lookup table (20,000 entries, 0.00005 step)
  - Pre-computed Greeks surface with Float32Array caching
  - Optimized d1/d2/N(d1)/N(d2) calculations
  - 30-day HV cache for VRP calculation
  - IV percentile tracking (252-day lookback)

#### Day Trading System (SPX Only)
- **Strategy**: Uses VIX + RSI for BUY/SELL signals on SPX
- **Timeframe**: Weekly Friday expirations (1-7 days) with ATM/OTM strikes
- **Target ROI**: 50-150%
- **Priority**: SPX recommendations prioritized

#### Elite Dual-Strategy Scanner (Stocks)
- **Strategy**: RSI-only momentum scanner for CALL/PUT strategies
- **Universe**: 100+ stocks and ETFs
- **Influence**: VIX/SPX sentiment
- **Target ROI**: 100-300% for 5-10 day swing trades

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
- **Risk Management**: Automated stop loss at 45% loss, aggressive partial profit-taking (50% trim at +35% ROI, full exit at +65% ROI) to protect gains in volatile options markets.
- **Hybrid AI Analysis**: Combines an internal `PortfolioAnalysisEngine` (RSI, VIX, Greeks, Fibonacci, P&L exit strategies, 24-hour hold/settlement enforcement) with `GrokAIService` for complex scenarios (high risk, urgent exits, low confidence, rebalance opportunities).
- **Goal Tracking**: Monitors progress towards a $1M target with progress percentage, required growth multiplier, and status assessment.
- **Strategic Recommendations**: Provides actionable insights (EXIT_POSITION, TAKE_PROFIT, REBALANCE, NEW_POSITION) with urgency, action, expected impact, execution constraints, and explicit trim percentages.
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
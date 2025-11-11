# Overview

This project is an AI-powered options trading dashboard designed to provide market analysis, trade recommendations, and portfolio management. It leverages web scraping and AI algorithms to identify high-confidence options trading opportunities, complete with calculated Greeks and risk metrics. The system aims to empower users with data-driven insights for profitable options trading.

# Recent Changes

## Dashboard Market Overview - Day-Based Changes (November 10, 2025)
- **Feature**: S&P 500, NASDAQ, and VIX now display % and point changes from most recent trading day's open to close
- **Implementation**: Uses Polygon API to fetch open/close prices via aggregates endpoint with 5-day lookback
- **Calculation**: Change = Close Price - Open Price | Change% = (Change / Open Price) × 100
- **Weekend Display**: Shows Friday's open-to-close movement when markets are closed
- **Live Trading**: Displays real-time intraday changes during market hours (Mon-Fri 9:30 AM - 4:00 PM ET)
- **Data Sources**: SPY (S&P 500 proxy), NDX (NASDAQ-100), VXX (VIX proxy) for reliable data availability

## Fibonacci Retracement - 4-Hour Chart Upgrade (November 10, 2025)
- **Upgrade**: Changed from daily bars to 4-hour bars for Fibonacci calculations
- **Data Volume**: ~360 four-hour candles (60 days) vs ~60 daily candles  
- **Precision**: More granular price action analysis for better entry point validation
- **Technical Levels**: 0.618 and 0.707 Fibonacci retracement levels with bounce detection

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript, using Vite.
- **UI**: Shadcn/ui (Radix UI, Tailwind CSS).
- **State Management**: TanStack Query for server state.
- **Real-Time Data**: Server-Sent Events (SSE) with a custom React hook for live price and Greeks streaming.
- **Routing**: Wouter.
- **Styling**: Dark-themed design system with CSS variables.

## Real-Time Data Streaming Architecture
- **Server-Side**: Polygon WebSocket (primary) + Tastytrade WebSocket (fallback) feed in-memory cache, which is polled by an SSE endpoint every second to stream to clients.
- **Client-Side**: EventSource connects to `/api/quotes/stream` to consume live stock quotes (bid/ask/price/volume) and real-time Greeks (delta, gamma, theta, vega, rho) calculated every second using a backend Black-Scholes model.
- **Fallback System**: Polygon, Tastytrade, and web scraping ensure continuous live updates.
- **Visuals**: Green pulsing dot indicates live data.

## Backend Architecture
- **Runtime**: Node.js with Express.js (TypeScript, ES modules).
- **API**: RESTful endpoints for market data, AI insights, and trade management.
- **Data Processing**: Real-time market data scraping (cheerio, axios).
- **Financial Calculations**: Custom Black-Scholes options pricing model for Greeks.

## Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Normalized tables for users, market data, options trades, and AI insights.
- **Storage Strategy**: In-memory storage with an interface for database swapping.
- **Migrations**: Drizzle Kit.

## Core Business Logic

### Day Trading System (SPX Only)
- **Instruments**: SPX (S&P 500 Index) only.
- **Signals**: VIX + RSI formula for SELL (PUT) and BUY (CALL) signals.
- **Expirations**: Weekly Friday expirations (1-7 days timeframe).
- **Strike Selection**: ATM or very close OTM.
- **ROI Targets**: 50-150%.
- **Budget**: $2000 maximum per trade, ensuring at least 1 contract for SPX.
- **Priority**: Always appears as the top recommendation.

### Elite Dual-Strategy Scanner (Stocks)
- **Stock Universe**: 100+ stocks across various sectors, plus major ETFs.
- **Signals**: RSI-only momentum scanner for CALL (oversold) and PUT (overbought) strategies, influenced by VIX and SPX sentiment.
- **ROI Targets**: 100-300% projected returns for swing trades (5-10 day holds).
- **Resilience**: Functions even when market data for `changePercent` is unavailable.

### Shared Features
- **Web Scraper**: Retrieves market data including 52-week ranges, prices, and indices.
- **Financial Calculations**: Black-Scholes for options Greeks and pricing.
- **Trade Budget**: $1000 maximum per trade with smart contract allocation.
- **Pricing**: Entry prices at current market price (±1%).
- **Dynamic Values**: ROI and confidence fluctuate with market volatility.
- **Fresh Scan**: Each refresh triggers new analysis.

### Fibonacci Retracement Validation (Elite Scanner Only)
- **Technical Analysis**: Validates entry points using 0.707 (Golden) and 0.618 (Classic) Fibonacci retracement levels based on **4-hour chart** data from Polygon.
- **Chart Timeframe**: Uses 4-hour bars over 60-day lookback period (~360 candles) for accurate technical analysis.
- **Confidence Boost**: Fibonacci bounces add +10% AI confidence.
- **Caching**: 1-hour TTL per symbol to reduce API calls.
- **Graceful Fallback**: Handles Polygon rate limits by still displaying trades without Fibonacci metadata.

### Fibonacci UI Features (TradeCard Component)
- **Color-Coded Prices**: Gold (0.707 bounce) or Green (0.618 bounce).
- **Fibonacci Badge**: Displays "FIB 0.707" or "FIB 0.618" with tooltip.
- **Estimated Profit**: Prominent display of projected dollar profit.

### Portfolio Exit Analysis System (Real Tastytrade Data Only)
- **Data Source**: ALL portfolio positions are fetched from real Tastytrade API - NO mock data exists.
- **API Endpoints**: Single source of truth via `/api/portfolio/positions` (all `/api/positions` mock endpoints removed).
- **Risk Management**: Automated stop loss recommendations at 45% loss threshold to protect capital.
- **Profit-Taking Strategy**: Incremental exit recommendations starting at 100% ROI:
  - +100% ROI: Trim 50% of position
  - +150% ROI: Trim additional 25%
  - +200% ROI: Close remaining position
- **Opportunity Comparison**: Identifies better trade opportunities from current scanner results for capital reallocation.
- **Real-Time P&L**: Live profit/loss tracking with SSE-powered price updates and 100x contract multiplier for options.
- **Greeks Monitoring**: Displays real-time Greeks (delta, gamma, theta, vega, rho) for options positions with time decay alerts.
- **Position Management**: Read-only view of Tastytrade account positions (no local position creation/deletion).
- **Contract Multiplier**: Options P&L calculations apply 100x multiplier (1 contract = 100 shares) for accurate pricing.
- **UI Structure**: 
  - Dashboard "Portfolio" tab: Shows redirect message to standalone Portfolio page
  - `/portfolio` page: Single source of truth for viewing real Tastytrade positions

### Hybrid AI Portfolio Analysis System (Internal + Grok AI)
- **Architecture**: Proprietary internal AI as primary engine with Grok AI as intelligent enhancement layer
- **Internal AI Engine**: `PortfolioAnalysisEngine` compiles all existing trading logic:
  - RSI (14-period) momentum analysis
  - VIX volatility assessment
  - Black-Scholes Greeks calculations
  - Fibonacci retracement validation (0.618/0.707 levels)
  - P&L-based exit strategies (45% stop loss, 100%+ profit taking)
  - 24-hour minimum hold period enforcement
  - 24-hour fund settlement period tracking
- **Grok AI Enhancement**: `GrokAIService` triggers for complex scenarios:
  - Portfolio risk level >= HIGH or CRITICAL
  - Position requires urgent exit
  - Recommendation confidence < 70%
  - Rebalance opportunities detected
  - Gracefully degrades if Grok API unavailable
- **API Endpoint**: `/api/portfolio/ai-analysis` aggregates:
  - Live Tastytrade positions and account data
  - Real-time market prices and Greeks
  - VIX volatility levels
  - Current scanner trade opportunities
  - Strategic recommendations with risk scoring
- **Goal Tracking**: $1M target from current account value:
  - Progress percentage calculation
  - Required growth multiplier (e.g., 542x)
  - On-track status assessment
  - Remaining capital needed
- **Strategic Recommendations**: Actionable insights categorized by:
  - Type: EXIT_POSITION, TAKE_PROFIT, REBALANCE, NEW_POSITION
  - Urgency: LOW, MEDIUM, HIGH
  - Action: CLOSE, TRIM, REALLOCATE, ENTER
  - Expected impact: P&L realized, capital freed, potential ROI
  - Execution constraints: 24h hold/settlement compliance
- **Risk Assessment**: Real-time portfolio risk levels:
  - LOW: Healthy positions, minimal exposure
  - MEDIUM: Moderate risk, monitoring recommended
  - HIGH: Significant exposure, action suggested
  - CRITICAL: Urgent intervention required
- **Frontend Component**: `PortfolioAIInsights.tsx` displays:
  - Hybrid AI badge indicating internal + Grok analysis
  - Portfolio risk level with color coding
  - Goal progress with visual progress bar
  - Strategic recommendations with urgency indicators
  - Actionable insights categorized by priority
  - Grok enhancement section (when triggered) with cyan accent
  - Auto-refresh every 30 seconds
  - Full test coverage with data-testid attributes
- **UI Design**:
  - Purple gradient card for internal AI analysis
  - Cyan gradient card for Grok AI enhancements
  - Risk badges: Red (CRITICAL), Orange (HIGH), Yellow (MEDIUM), Green (LOW)
  - Urgency icons for recommendations
  - "24h Rule" badges for constrained positions

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.

## Financial Data Sources (Prioritized)
- **Polygon/Massive.com (PRIMARY)**: Real-time market data via WebSocket (stock quotes) and REST API (options quotes, Greeks, IV). Handles 100% US stocks and options.
- **Tastytrade API (SPX OPTIONS PRIMARY)**: Real-time options data via DXLink WebSocket, specifically for SPX index options, providing real market Greeks, IV, and theoretical prices.
- **Google Finance (FALLBACK)**: Web scraping for stock prices, ETFs, and market indices when primary sources are unavailable.
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
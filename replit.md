# Overview

This project is an AI-powered options trading dashboard designed to provide institutional-grade tools for market analysis, trade recommendations, and portfolio management. It integrates multiple advanced trading systems, including a high-win-rate Ghost 1DTE overnight scanner, and leverages real-time data, AI analysis, and sophisticated quantitative strategies to deliver actionable insights and support informed investment decisions. The project aims to empower users with tools typically reserved for professionals, enhancing their market understanding and trading performance.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript and Vite.
- **UI**: Shadcn/ui (Radix UI, Tailwind CSS) for a dark-themed design system.
- **State Management**: TanStack Query for server state.
- **Real-Time Data**: Server-Sent Events (SSE) via a custom React hook.
- **Routing**: Wouter.

## Real-Time Data Streaming
- **Server-Side**: Polygon and Tastytrade WebSockets feed an in-memory cache, streamed via an SSE endpoint.
- **Client-Side**: EventSource connects to `/api/quotes/stream` for live stock quotes and real-time Greeks.
- **Fallback System**: Polygon, Tastytrade, and web scraping ensure continuous data updates.

## Backend Architecture
- **Runtime**: Node.js with Express.js (TypeScript, ES modules).
- **API**: RESTful endpoints for market data, AI insights, and trade management.
- **Data Processing**: Real-time market data scraping and financial calculations.
- **Financial Calculations**: Custom Black-Scholes options pricing model.
- **Polygon API Throttling**: Dual Bottleneck system prevents rate limits while respecting unlimited plan fair-use policies:
  - **Standard Limiter**: 200ms minTime, 5 maxConcurrent, 100/min reservoir (rate-limited requests)
  - **Lightweight Limiter**: 300ms minTime, 2 maxConcurrent, no reservoir (unlimited-mode scanners)
  - **Auth Fallback**: Bearer token → query param on 401 errors
  - **Smart Retries**: Exponential backoff for 429/5xx, short-circuit for 401/403 to prevent retry storms
  - **Result Caps**: limit=50000 (historical), limit=5000 (minute), limit=250 (options snapshots)

## Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Normalized tables for users, market data, options trades, AI insights, and AI learning data (marketInsights, performanceMetrics, learningSessions).

## Core Business Logic

### Market Scanning and Data
- **BatchDataService**: Fetches and caches ~11,600 stocks from Polygon for efficient market scanning.
- **Elite Scanner**: Institutional-grade scanner with strict filtering for high-quality trade recommendations, operating in under 1 second.
- **Shared WebSocket Architecture**: PolygonService provides a single shared WebSocket connection for stock and option quote streaming, including health monitoring and reconnection logic.
- **API Authentication**: Uses `Authorization: Bearer` headers for Polygon/Massive.com to ensure unlimited access for Advanced Options Plan users.
- **Centralized Auth**: All REST API calls use PolygonService.makeRateLimitedRequest() for consistent authentication, retry logic, and rate limit management.
- **ExpirationService**: Queries live option chains for accurate expiration dates.

### Trading Systems
- **Ghost 1DTE Overnight Scanner**: High-win-rate strategy scanning the full S&P 500 (503 tickers) using a 4-layer AI scoring system for entry signals.
  - **Universe**: S&P 500 with parallel batch processing (50 symbols/batch).
  - **Performance**: Completes 503-ticker scan in under 3 seconds with 30-second timeout protection.
  - **Error Handling**: Graceful initialization fallback using default HV values (20%) when Polygon historical data unavailable.
  - **Data Sources**: Polygon unlimited mode with fail-fast logic (no Alpha Vantage fallback to prevent rate-limiting delays).
  - **Grok AI Enhancements (Phase 4)**: Includes strict Theta (< -0.08) and Gamma (> 0.12) filtering, specific IV ranges, and a defined entry window (2:00-3:00 PM CST) and exit time (8:32 AM CST next day).
- **Day Trading System (SPX Only)**: Utilizes VIX + RSI for BUY/SELL signals on SPX weekly expirations.
- **Elite Dual-Strategy Scanner (Stocks)**: RSI-based momentum scanner for CALL/PUT strategies on 100+ stocks and ETFs, targeting 3-5 high-quality plays per day.
  - **24/7 Operation**: Operates continuously using dual-mode analysis (live data during market hours, EOD + overnight aggregates when closed).
  - **Live Mode (8:30 AM - 3:00 PM CST)**: RSI oversold < 40, volume spike > 1.5x, intraday momentum > 1.5%, premium > $0.30, pivot breakout required.
  - **Overnight Mode (8:00 PM - 8:30 AM CST)**: Uses real indicator calculations (RSI, EMA20, ATR) from EOD snapshot + overnight bars (4-8 PM CST aggregates).
    - **Indicator Calculations**: `server/utils/indicators.ts` provides real RSI (14-period gains/losses), EMA (exponential smoothing), and ATR (true range averaging).
    - **Liquidity-Aware Filters**: Asymmetric RSI thresholds (45/55 to avoid neutral zone), relaxed volume/ATR requirements (1.2x vs live 1.5x), minimum 0.8% price movement.
    - **Data Validation**: Requires ≥20 bars (EOD + overnight), ≥50% bars with volume, filters zero-volume bars.
    - **Contract Selection**: ATM ±5%, DTE 3-7, premium ≥$0.30, delta 0.3-0.6, ranked by volume + OI.
    - **Signal Quality**: Capped at 80 (no live Greeks), based on RSI extremes, volume spike, price movement, premium size, and liquidity.
    - **Detailed Logging**: Filter progression tracking at each step (RSI, EMA alignment, price movement, volume, ATR, contract filtering) for diagnostics.
  - **Core Requirements**: Trend alignment (EMA20), ATR momentum, and pivot breakout confirmation.
  - **Grok AI Enhancements**: Incorporates pivot level calculation, volume spike detection, intraday momentum, and breakout confirmation.

### Shared Features
- **Trade Budget**: $1000 maximum per trade with smart contract allocation.
- **Fibonacci Retracement Validation**: Validates entry points using Fibonacci levels with fractal swing detection.
- **VIX Squeeze Kill Switch**: Real-time alert system for high-confidence 0DTE PUT opportunities when VIX >= 20 with >5% change.
  - **Alert UI**: Red pulsing banner with "BUY SPY 0DTE PUT", confidence rating, VIX metrics, and entry/exit windows.
  - **Auto-Refresh**: Component polls every 5 seconds for live alert status.
- **Dashboard Market Overview**: Displays real-time S&P 500, NASDAQ, and VIX metrics using hierarchical data sources (Tastytrade WebSocket, Google Finance scraping).
  - **Change Calculation**: Real-time changePercent using `(currentPrice - openPrice) / openPrice * 100`.
- **Recommendation Validation System**: Automatically filters stale (>120min old) and invalid (>2% adverse price movement) recommendations.
  - **Auto-Refresh**: Background job refreshes recommendations every 15 minutes during market hours.

### Self-Learning System (AI Education Engine)
- **Architecture**: Five core services orchestrate autonomous learning using Grok AI reasoning.
- **Learning Loop**: Automated daily outcome analysis, weekly pattern discovery, and bi-weekly parameter optimization.
- **Grok AI Integration**: Sends trade summaries to Grok for deep pattern analysis and structured recommendations.
- **Strategy Evolution**: Tracks recommendations, analyzes outcomes, and dynamically adjusts strategy parameters.

### Portfolio Management (Hybrid AI)
- **Data Source**: Fetches positions from Tastytrade API.
- **Risk Management**: Automated stop loss and aggressive partial profit-taking.
- **Hybrid AI Analysis**: Combines an internal `PortfolioAnalysisEngine` with `GrokAIService` for strategic recommendations.
- **Goal Tracking**: Monitors progress towards a $1M target.
- **Real-Time P&L & Greeks Monitoring**: Live tracking with SSE-powered updates.

### Time Synchronization System
- **Purpose**: Ensures accurate CST time detection for critical trading windows.
- **Primary Sync**: WorldTimeAPI (HTTP-based).
- **Fallback**: NTP servers (time.google.com, pool.ntp.org, time.cloudflare.com).
- **Manual Override**: Admin endpoints allow manual time correction for development/admin only.

### UI Features
- **CST Clock Component**: Real-time clock display on dashboard and Ghost page showing accurate CST time with market status indicator (LIVE/CLOSED).
- **Manual Scan Triggers**: "Run Scan" button for on-demand analysis for the Ghost 1DTE scanner.
- **Real-Time Dashboard**: Market overview with live S&P 500, NASDAQ, and VIX metrics via SSE streaming.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.

## Financial Data Sources
- **Polygon/Massive.com**: Primary real-time market data (WebSocket and REST API) for US stocks and options. Advanced Options Plan provides unlimited API access with fair-use throttling.
  - **Limitation**: Index symbols (I:SPX, I:COMP, I:VIX) return 403 errors - not included in Advanced Options Plan. System automatically falls back to Google Finance scraping.
- **Tastytrade API**: Primary real-time data (DXLink WebSocket) for SPX index when market is open.
- **Google Finance**: Primary web scraping for all market indices (S&P 500, NASDAQ, VIX), and fallback for SPX and Polygon index queries.
- **MarketWatch**: Secondary web scraping fallback.
- **WorldTimeAPI**: Primary source for time synchronization.
- **NTP Servers**: (time.google.com, pool.ntp.org, time.cloudflare.com) for time synchronization fallback.

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
# Overview

This project is an AI-powered options trading dashboard providing institutional-grade tools for market analysis, trade recommendations, and portfolio management. It features multiple trading systems, including a high-win-rate Ghost 1DTE overnight scanner, and leverages real-time data, AI analysis, and advanced quantitative strategies to deliver insights and support investment decisions.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript and Vite.
- **UI**: Shadcn/ui (Radix UI, Tailwind CSS) with a dark-themed design system.
- **State Management**: TanStack Query for server state.
- **Real-Time Data**: Server-Sent Events (SSE) via a custom React hook.
- **Routing**: Wouter.

## Real-Time Data Streaming Architecture
- **Server-Side**: Polygon and Tastytrade WebSockets feed an in-memory cache, streamed via an SSE endpoint.
- **Client-Side**: EventSource connects to `/api/quotes/stream` for live stock quotes and real-time Greeks.
- **Fallback System**: Polygon, Tastytrade, and web scraping ensure continuous updates.

## Backend Architecture
- **Runtime**: Node.js with Express.js (TypeScript, ES modules).
- **API**: RESTful endpoints for market data, AI insights, and trade management.
- **Data Processing**: Real-time market data scraping.
- **Financial Calculations**: Custom Black-Scholes options pricing model.

## Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Normalized tables for users, market data, options trades, and AI insights.
- **AI Learning Schema**: Includes `marketInsights` for AI-discovered patterns, `performanceMetrics` for strategy aggregates, and `learningSessions` for audit trails of AI learning runs.

## Core Business Logic

### Market Scanning
- **BatchDataService**: Fetches and caches ~11,600 stocks from Polygon Bulk Snapshot, shared across all scanners for efficiency.
- **Dual Scanner Architecture**:
    - **Ghost Sweep Detector (Real-Time UOA)**: Real-time institutional sweep detection using Polygon Options WebSocket. Monitors 20 high-volume tickers (NVDA, TSLA, SPY, QQQ, AMD, META, AAPL, AMZN, GOOGL, MSFT, SMCI, COIN, MARA, HOOD, RIVN, IWM, PLTR, SOFI, NKLA, NIO) for $2M+ premium sweeps with trade conditions 10-13. Event-driven architecture triggers instant Phase 4 scoring (Max Pain, IV Skew, RSI, Ghost Intelligence) when sweeps are detected. **Instant alerts** vs. 20-minute sequential scanning.
    - **Elite Scanner**: Institutional-grade scanner with strict filtering criteria.
- **Shared WebSocket Architecture**: PolygonService provides single shared WebSocket connection for both stock quotes and option trades via callback-based routing. Eliminates duplicate connections and respects Polygon connection limits. Includes health monitoring and exponential backoff reconnection.
- **Market Data Pipeline**: Efficiently fetches and filters market data, eliminating redundant API calls.
- **API Rate Limits**: Advanced Options Plan provides unlimited API calls for real-time option trade streaming and historical data fetching.
- **ExpirationService**: Queries live option chains for accurate expiration dates.

### Trading Systems
- **Ghost 1DTE Overnight Scanner (GROK PHASE 4 ENHANCED)**: High-win-rate strategy for SPY, QQQ, IWM using a 4-layer AI scoring system for entry signals and robust technical optimizations. Includes a manual pre-trade checklist for execution.
- **Day Trading System (SPX Only)**: Uses VIX + RSI for BUY/SELL signals on SPX weekly expirations.
- **Elite Dual-Strategy Scanner (Stocks)**: RSI-only momentum scanner for CALL/PUT strategies on 100+ stocks and ETFs.

### Shared Features
- **Financial Calculations**: Black-Scholes for options Greeks and pricing.
- **Trade Budget**: $1000 maximum per trade with smart contract allocation.
- **Fibonacci Retracement Validation**: Validates entry points using Fibonacci levels with fractal swing detection.
- **Dashboard Market Overview**: Displays real-time S&P 500, NASDAQ, and VIX metrics.
- **Recommendation Validation System**: Automatically filters stale and invalid recommendations using two criteria:
    - **Staleness Filter**: Removes recommendations >120min old to ensure fresh market data
    - **Price Movement Filter**: Removes recommendations with >2% adverse price movement from entry thesis
    - **Auto-Refresh**: Background job refreshes all recommendations every 15 minutes during market hours (9:30am-4:00pm ET)
    - **Logging**: Detailed filtering reasons (e.g., "Stale (869min old)") for debugging

### Self-Learning System (AI Education Engine)
- **Architecture**: Five core services orchestrate autonomous learning using Grok AI reasoning.
- **Learning Loop**: Automated daily outcome analysis, weekly pattern discovery via Grok, and bi-weekly parameter optimization.
- **Grok AI Integration**: Sends trade summaries to Grok for deep pattern analysis and structured recommendations.
- **Strategy Evolution**: Tracks recommendations, analyzes outcomes, and dynamically adjusts strategy parameters.

### Portfolio Management (Hybrid AI)
- **Data Source**: Fetches positions from Tastytrade API.
- **Risk Management**: Automated stop loss and aggressive partial profit-taking.
- **Hybrid AI Analysis**: Combines an internal `PortfolioAnalysisEngine` with `GrokAIService` for complex scenarios and strategic recommendations.
- **Goal Tracking**: Monitors progress towards a $1M target.
- **Real-Time P&L & Greeks Monitoring**: Live tracking with SSE-powered updates.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL.
- **Drizzle ORM**: Type-safe database toolkit.

## Financial Data Sources
- **Polygon/Massive.com**: Primary real-time market data (WebSocket and REST API) for US stocks and options.
- **Tastytrade API**: Primary real-time options data (DXLink WebSocket) for SPX index options.
- **Google Finance**: Fallback web scraping for stock prices and indices.
- **MarketWatch**: Secondary web scraping fallback.

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
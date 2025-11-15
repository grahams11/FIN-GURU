import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OptionsTrade } from "@shared/schema";

interface OptionPremium {
  premium: number;
  bid: number;
  ask: number;
  source: 'polygon' | 'tastytrade' | 'model';
}

interface Quote {
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
  source?: string;
  greeks?: {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
    rho: number;
  };
  option?: OptionPremium;
  liveROI?: number;
}

interface TradeCardProps {
  trade: OptionsTrade;
  rank: number;
  liveQuotes?: Record<string, Quote>;
}

// Format numbers with commas for thousands
const formatNumber = (num: number, decimals: number = 2): string => {
  return num.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  });
};

export function TradeCard({ trade, rank, liveQuotes }: TradeCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const livePrice = liveQuotes?.[trade.ticker]?.price;
  const currentDisplayPrice = livePrice || trade.currentPrice;
  
  // Get live option premium from SSE if available
  const liveOptionPremium = liveQuotes?.[trade.ticker]?.option;
  const displayPremium = liveOptionPremium?.premium ?? trade.premium ?? trade.entryPrice;
  const isPremiumLive = !!liveOptionPremium && (liveOptionPremium.source === 'polygon' || liveOptionPremium.source === 'tastytrade');
  
  // Get live ROI if available, otherwise use projected ROI
  const liveROI = liveQuotes?.[trade.ticker]?.liveROI;
  const displayROI = liveROI ?? trade.projectedROI;
  const isROILive = liveROI != null;

  const executeMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/execute-trade/${trade.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/top-trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio-summary"] });
      toast({
        title: "Trade Executed",
        description: `Successfully executed ${trade.ticker} options trade`,
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Execution Failed",
        description: "Failed to execute trade. Please try again.",
      });
    },
  });

  const getRankColor = (rank: number) => {
    if (rank === 1) return "bg-primary";
    if (rank === 2) return "bg-accent";
    return "bg-muted";
  };

  const getRankTextColor = (rank: number) => {
    if (rank === 1) return "text-primary-foreground";
    if (rank === 2) return "text-accent-foreground";
    return "text-foreground";
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return "text-primary";
    if (confidence >= 0.8) return "text-accent";
    return "text-foreground";
  };

  // Get Fibonacci color for stock price
  const getFibonacciPriceColor = () => {
    if (trade.fibonacciColor === 'gold') return 'text-yellow-400';
    if (trade.fibonacciColor === 'green') return 'text-green-400';
    return 'text-primary';
  };

  return (
    <Card className="bg-secondary border-border hover:border-primary/50 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 ${getRankColor(rank)} rounded-lg flex items-center justify-center`}>
              <span className={`font-bold ${getRankTextColor(rank)}`} data-testid={`rank-${rank}`}>
                {rank}
              </span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-bold" data-testid={`ticker-${trade.ticker}`}>
                  {trade.ticker}
                </h3>
                <span 
                  className={`text-xs font-bold px-2 py-1 rounded ${
                    trade.optionType === 'put' 
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40' 
                      : 'bg-green-500/20 text-green-400 border border-green-500/40'
                  }`}
                  data-testid={`option-type-${trade.ticker}`}
                >
                  {trade.optionType?.toUpperCase() ?? 'CALL'}
                </span>
                {trade.isWatchlist && (
                  <span 
                    className="text-xs font-bold px-2 py-1 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/40"
                    data-testid={`watchlist-badge-${trade.ticker}`}
                    title="Overnight watchlist - verify with live data at market open"
                  >
                    WATCHLIST
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {trade.isWatchlist ? 'Overnight Watchlist Setup' : trade.optionType === 'put' ? 'Bearish Elite Play' : 'Bullish Elite Play'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end space-x-1 mb-1">
              <p className={`text-lg font-bold ${displayROI >= 100 ? 'text-green-500 animate-pulse' : displayROI >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid={`roi-${trade.ticker}`}>
                {displayROI > 0 ? '+' : ''}{displayROI.toFixed(0)}%
              </p>
              {isROILive && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" title="Live ROI from market data"></span>}
              {!isROILive && <span className="w-2 h-2 bg-yellow-500 rounded-full" title="Projected ROI (market closed or no live data)"></span>}
            </div>
            <p className="text-sm text-muted-foreground">
              {displayROI >= 100 ? '✨ Elite ROI ✨' : isROILive ? 'Live ROI' : 'Projected ROI'}
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center space-x-1">
              <span>Stock Price</span>
              {livePrice && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" title="Live Price"></span>}
              {trade.fibonacciLevel != null && (
                <span 
                  className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    trade.fibonacciColor === 'gold' 
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40' 
                      : 'bg-green-500/20 text-green-400 border border-green-500/40'
                  }`}
                  title={`Fibonacci ${trade.fibonacciLevel} retracement bounce`}
                >
                  FIB {trade.fibonacciLevel}
                </span>
              )}
            </p>
            <p className={`text-sm font-medium ${getFibonacciPriceColor()}`} data-testid={`current-${trade.ticker}`}>
              ${formatNumber(currentDisplayPrice)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Strike</p>
            <p className="text-sm font-medium" data-testid={`strike-${trade.ticker}`}>
              ${formatNumber(trade.strikePrice)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center space-x-1">
              <span>Premium/Contract</span>
              {isPremiumLive && <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" title={`Live Premium from ${liveOptionPremium?.source}`}></span>}
            </p>
            <div className="flex items-center space-x-1">
              <p className="text-sm font-medium text-accent" data-testid={`premium-${trade.ticker}`}>
                ${formatNumber(displayPremium)}
              </p>
              {!isPremiumLive && (
                <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded" title="Estimated using Black-Scholes model. Verify with your broker before trading.">
                  EST
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Contracts</p>
            <p className="text-sm font-medium" data-testid={`contracts-${trade.ticker}`}>
              {trade.contracts.toLocaleString()}
            </p>
          </div>
          <div className="bg-primary/10 rounded-md p-2 border border-primary/20">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">💰 Total Cost</p>
            <p className="text-base font-bold text-primary" data-testid={`total-cost-${trade.ticker}`}>
              ${formatNumber(trade.totalCost ?? (trade.contracts * trade.entryPrice * 100))}
            </p>
          </div>
        </div>

        {trade.estimatedProfit != null && (
          <div className="bg-gradient-to-r from-green-500/20 to-green-400/10 rounded-lg p-4 mb-4 border border-green-500/30">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">💰 Estimated Profit</p>
            <p className="text-2xl font-bold text-green-500 animate-pulse" data-testid={`estimated-profit-${trade.ticker}`}>
              ${formatNumber(trade.estimatedProfit, 0)}
            </p>
            <p className="text-xs text-muted-foreground">projected dollar profit at target exit</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4 bg-gradient-to-r from-green-500/10 to-accent/10 rounded-lg p-4 border border-green-500/20">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">💵 Exit Premium Target</p>
            <p className="text-lg font-bold text-green-500" data-testid={`exit-target-${trade.ticker}`}>
              ${formatNumber(trade.exitPrice || 0)}
            </p>
            <p className="text-xs text-muted-foreground">option premium per contract</p>
          </div>
          <div className="bg-green-500/10 rounded-md p-2 border border-green-500/30">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">💰 Projected ROI Amount</p>
            <p className="text-lg font-bold text-green-400" data-testid={`roi-amount-${trade.ticker}`}>
              ${trade.projectedROIAmount != null ? formatNumber(trade.projectedROIAmount, 0) : 'N/A'}
            </p>
            <p className="text-xs text-muted-foreground">total exit value</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">🎯 Stock Price Target</p>
            <p className="text-lg font-bold text-green-400" data-testid={`stock-exit-${trade.ticker}`}>
              ${trade.stockExitPrice != null ? formatNumber(trade.stockExitPrice) : 'N/A'}
            </p>
            <p className="text-xs text-muted-foreground">target stock price at exit</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">⏰ Projected Hold</p>
            <p className="text-lg font-bold text-accent" data-testid={`hold-days-${trade.ticker}`}>
              {trade.holdDays ?? 'N/A'} days
            </p>
            <p className="text-xs text-muted-foreground">optimal exit window</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">📅 Expiration</p>
            <p className="text-lg font-bold" data-testid={`expiry-${trade.ticker}`}>
              {trade.expiry}
            </p>
            <p className="text-xs text-muted-foreground">must exit by this date</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-primary rounded-full"></div>
            <span className="text-sm text-muted-foreground">
              AI Confidence: 
              <span 
                className={`font-medium ml-1 ${getConfidenceColor(trade.aiConfidence)}`}
                data-testid={`confidence-${trade.ticker}`}
              >
                {Math.round(trade.aiConfidence * 100)}%
              </span>
            </span>
          </div>
          <Button
            onClick={() => executeMutation.mutate()}
            disabled={executeMutation.isPending || (trade.isExecuted ?? false)}
            className={`${rank === 1 ? 'bg-primary hover:bg-primary/90' : 
                       rank === 2 ? 'bg-accent hover:bg-accent/90' : 
                       'bg-secondary hover:bg-secondary/80 border border-border'} transition-colors`}
            data-testid={`execute-${trade.ticker}`}
          >
            {executeMutation.isPending ? 'Executing...' : 
             (trade.isExecuted ?? false) ? 'Executed' : 'Execute Trade'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

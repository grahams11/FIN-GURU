import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { OptionsTrade, Greeks } from "@shared/schema";

interface TradeCardProps {
  trade: OptionsTrade;
  rank: number;
}

export function TradeCard({ trade, rank }: TradeCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
                    (trade as any).optionType === 'put' 
                      ? 'bg-red-500/20 text-red-400 border border-red-500/40' 
                      : 'bg-green-500/20 text-green-400 border border-green-500/40'
                  }`}
                  data-testid={`option-type-${trade.ticker}`}
                >
                  {((trade as any).optionType?.toUpperCase() || 'CALL')}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {(trade as any).optionType === 'put' ? 'Bearish Elite Play' : 'Bullish Elite Play'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className={`text-lg font-bold ${trade.projectedROI >= 100 ? 'text-green-500 animate-pulse' : trade.projectedROI >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid={`roi-${trade.ticker}`}>
              {trade.projectedROI > 0 ? '+' : ''}{trade.projectedROI.toFixed(0)}%
            </p>
            <p className="text-sm text-muted-foreground">
              {trade.projectedROI >= 100 ? '✨ Elite ROI ✨' : 'Projected ROI'}
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Stock Price</p>
            <p className="text-sm font-medium text-primary" data-testid={`current-${trade.ticker}`}>
              ${trade.currentPrice.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Strike</p>
            <p className="text-sm font-medium" data-testid={`strike-${trade.ticker}`}>
              ${trade.strikePrice.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Premium/Contract</p>
            <div className="flex items-center space-x-1">
              <p className="text-sm font-medium text-accent" data-testid={`premium-${trade.ticker}`}>
                ${(trade as any).premium?.toFixed(2) || trade.entryPrice.toFixed(2)}
              </p>
              <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded" title="Estimated using Black-Scholes model. Verify with your broker before trading.">
                EST
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Contracts</p>
            <p className="text-sm font-medium" data-testid={`contracts-${trade.ticker}`}>
              {trade.contracts}
            </p>
          </div>
          <div className="bg-primary/10 rounded-md p-2 border border-primary/20">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">💰 Total Cost</p>
            <p className="text-base font-bold text-primary" data-testid={`total-cost-${trade.ticker}`}>
              ${(trade as any).totalCost?.toFixed(2) || (trade.contracts * trade.entryPrice * 100).toFixed(2)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 bg-gradient-to-r from-green-500/10 to-accent/10 rounded-lg p-4 border border-green-500/20">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">💵 Exit Premium Target</p>
            <p className="text-lg font-bold text-green-500" data-testid={`exit-target-${trade.ticker}`}>
              ${trade.exitPrice?.toFixed(2) || 'N/A'}
            </p>
            <p className="text-xs text-muted-foreground">sell each contract at this price</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">⏰ Projected Hold</p>
            <p className="text-lg font-bold text-accent" data-testid={`hold-days-${trade.ticker}`}>
              {(trade as any).holdDays || 'N/A'} days
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

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-muted rounded-md p-3">
            <p className="text-xs text-muted-foreground">Delta</p>
            <p className="text-sm font-medium" data-testid={`delta-${trade.ticker}`}>
              {(trade.greeks as Greeks).delta.toFixed(4)}
            </p>
          </div>
          <div className="bg-muted rounded-md p-3">
            <p className="text-xs text-muted-foreground">Gamma</p>
            <p className="text-sm font-medium" data-testid={`gamma-${trade.ticker}`}>
              {(trade.greeks as Greeks).gamma.toFixed(4)}
            </p>
          </div>
          <div className="bg-muted rounded-md p-3">
            <p className="text-xs text-muted-foreground">Theta</p>
            <p className="text-sm font-medium text-destructive" data-testid={`theta-${trade.ticker}`}>
              {(trade.greeks as Greeks).theta.toFixed(4)}
            </p>
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

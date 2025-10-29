import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TradeCard } from "@/components/TradeCard";
import { Cpu, RefreshCw, Lightbulb } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { AiInsights, OptionsTrade } from "@shared/schema";

interface OptionsTraderAIProps {
  insights?: AiInsights;
  trades?: OptionsTrade[];
  isLoading: boolean;
}

export function OptionsTraderAI({ insights, trades, isLoading }: OptionsTraderAIProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/refresh-trades"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/top-trades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-insights"] });
      toast({
        title: "Success",
        description: "AI analysis refreshed successfully",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to refresh AI analysis. Please try again.",
      });
    },
  });

  const handleRefresh = () => {
    refreshMutation.mutate();
  };

  if (isLoading) {
    return (
      <Card className="bg-card border-border p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Skeleton className="w-12 h-12 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <Skeleton className="h-10 w-24" />
        </div>
        
        <div className="bg-secondary rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="text-center space-y-2">
                <Skeleton className="h-4 w-24 mx-auto" />
                <Skeleton className="h-6 w-16 mx-auto" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border p-6 mb-8 shadow-lg shadow-primary/5">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center">
            <Cpu className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground" data-testid="text-ai-title">Options Trader AI</h2>
            <p className="text-muted-foreground">AI-powered top 5 trade recommendations</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-muted-foreground" data-testid="text-last-updated">
            Updated {insights?.timestamp ? new Date(insights.timestamp).toLocaleTimeString() : 'N/A'}
          </span>
          <Button
            onClick={handleRefresh}
            disabled={refreshMutation.isPending}
            className="bg-primary hover:bg-primary/90"
            data-testid="button-refresh-trades"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Important Notice */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-start space-x-3">
          <Lightbulb className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-500 mb-1">Important: Premium Estimates</p>
            <p className="text-xs text-muted-foreground">
              Premium prices are calculated using the Black-Scholes model and may differ from your broker's actual prices. 
              <strong className="text-foreground"> Always verify costs with your broker before trading.</strong>
            </p>
          </div>
        </div>
      </div>

      {/* AI Analysis Summary */}
      <div className="bg-secondary rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Market Confidence</p>
            <p className="text-xl font-bold text-primary" data-testid="text-market-confidence">
              {insights?.marketConfidence ? `${Math.round(insights.marketConfidence * 100)}%` : 'N/A'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Volatility Forecast</p>
            <p className="text-xl font-bold text-accent" data-testid="text-volatility-forecast">
              {insights?.volatilityForecast ?? 'N/A'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Best Time Frame</p>
            <p className="text-xl font-bold text-foreground" data-testid="text-best-timeframe">
              {insights?.bestTimeFrame ?? 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* Top 5 Trade Recommendations */}
      <div className="space-y-4">
        {trades && trades.length > 0 ? (
          trades.slice(0, 5).map((trade, index) => (
            <TradeCard
              key={trade.id}
              trade={trade}
              rank={index + 1}
            />
          ))
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg" data-testid="text-no-trades">
              No trade recommendations available at this time.
            </p>
            <p className="text-muted-foreground text-sm mt-2">
              Click refresh to generate new AI recommendations.
            </p>
          </div>
        )}
      </div>

      {/* AI Insights Panel */}
      {insights?.insights && (
        <div className="mt-6 bg-muted rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            <Lightbulb className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold" data-testid="text-ai-insights-title">AI Insights</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            {Array.isArray(insights.insights) && (insights.insights as string[]).map((insight: string, index: number) => (
              <p key={index} className="text-muted-foreground" data-testid={`text-insight-${index}`}>
                • {insight}
              </p>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

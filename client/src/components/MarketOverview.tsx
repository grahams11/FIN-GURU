import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, Activity, Zap, Brain } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarketOverviewData } from "@shared/schema";

interface MarketOverviewProps {
  data?: MarketOverviewData;
  isLoading: boolean;
}

export function MarketOverview({ data, isLoading }: MarketOverviewProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="w-8 h-8 rounded" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      {/* S&P 500 */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">S&P 500</p>
              <p className="text-2xl font-bold" data-testid="text-sp500-value">
                {data?.sp500?.price ? data.sp500.price.toLocaleString() : 'N/A'}
              </p>
              <p 
                className={`text-sm ${(data?.sp500.changePercent ?? 0) >= 0 ? 'text-primary' : 'text-destructive'}`}
                data-testid="text-sp500-change"
              >
                {(data?.sp500.changePercent ?? 0) >= 0 ? '+' : ''}{(data?.sp500.changePercent ?? 0).toFixed(2)}% 
                ({(data?.sp500.changePercent ?? 0) >= 0 ? '+' : ''}{(data?.sp500.change ?? 0).toFixed(2)})
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-primary" />
          </div>
        </CardContent>
      </Card>
      
      {/* NASDAQ */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">NASDAQ</p>
              <p className="text-2xl font-bold" data-testid="text-nasdaq-value">
                {data?.nasdaq?.price ? data.nasdaq.price.toLocaleString() : 'N/A'}
              </p>
              <p 
                className={`text-sm ${(data?.nasdaq.changePercent ?? 0) >= 0 ? 'text-primary' : 'text-destructive'}`}
                data-testid="text-nasdaq-change"
              >
                {(data?.nasdaq.changePercent ?? 0) >= 0 ? '+' : ''}{(data?.nasdaq.changePercent ?? 0).toFixed(2)}% 
                ({(data?.nasdaq.changePercent ?? 0) >= 0 ? '+' : ''}{(data?.nasdaq.change ?? 0).toFixed(2)})
              </p>
            </div>
            <Activity className="w-8 h-8 text-primary" />
          </div>
        </CardContent>
      </Card>
      
      {/* VIX */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">VIX</p>
              <p className="text-2xl font-bold" data-testid="text-vix-value">
                {data?.vix?.price ? data.vix.price.toFixed(2) : 'N/A'}
              </p>
              <p 
                className={`text-sm ${(data?.vix.changePercent ?? 0) >= 0 ? 'text-primary' : 'text-destructive'}`}
                data-testid="text-vix-change"
              >
                {(data?.vix.changePercent ?? 0) >= 0 ? '+' : ''}{(data?.vix.changePercent ?? 0).toFixed(2)}% 
                ({(data?.vix.changePercent ?? 0) >= 0 ? '+' : ''}{(data?.vix.change ?? 0).toFixed(2)})
              </p>
            </div>
            <Zap className="w-8 h-8 text-accent" />
          </div>
        </CardContent>
      </Card>
      
      {/* AI Sentiment */}
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">AI Sentiment</p>
              <p className="text-2xl font-bold" data-testid="text-sentiment-score">
                {data?.sentiment.score ? `${Math.round(data.sentiment.score * 100)}%` : 'N/A'}
              </p>
              <p className="text-sm text-primary" data-testid="text-sentiment-label">
                {data?.sentiment.label ?? 'Unknown'}
              </p>
            </div>
            <Brain className="w-8 h-8 text-primary" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

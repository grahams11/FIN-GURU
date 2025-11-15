import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Database, Wifi } from 'lucide-react';

interface DataSourceStatus {
  isLive: boolean;
  source: 'live' | 'cache';
  lastUpdate: number;
  marketOpen: boolean;
}

export function DataSourceIndicator() {
  const { data, isLoading } = useQuery<DataSourceStatus>({
    queryKey: ['/api/data-source-status'],
    refetchInterval: 5000,
  });

  // Loading state - show neutral indicator while fetching
  if (isLoading || !data) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Data Source</p>
              <div className="flex items-center gap-2 mt-2">
                <div className="w-3 h-3 bg-gray-500 rounded-full animate-pulse" data-testid="indicator-loading" />
                <span className="text-sm font-semibold text-gray-500">LOADING...</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Checking status...</p>
            </div>
            <Database className="w-8 h-8 text-gray-500" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isLive = data.isLive;
  const source = data.source;
  const lastUpdate = data.lastUpdate;
  const marketOpen = data.marketOpen;

  const lastUpdateText = lastUpdate > 0 
    ? new Date(lastUpdate).toLocaleTimeString() 
    : 'N/A';

  const statusText = isLive 
    ? 'Live Data' 
    : marketOpen 
      ? 'Historical Data (API Unavailable)' 
      : 'Historical Data (Market Closed)';

  const tooltipContent = `${statusText}\nLast Update: ${lastUpdateText}\nSource: ${source.toUpperCase()}`;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Data Source</p>
            <div className="flex items-center gap-2 mt-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2">
                      {isLive ? (
                        <>
                          <div className="relative">
                            <div className="w-3 h-3 bg-green-500 rounded-full" data-testid="indicator-live" />
                            <div className="absolute inset-0 w-3 h-3 bg-green-500 rounded-full animate-ping opacity-75" />
                          </div>
                          <span className="text-sm font-semibold text-green-500">LIVE</span>
                        </>
                      ) : (
                        <>
                          <div className="w-3 h-3 bg-red-500 rounded-full" data-testid="indicator-historical" />
                          <span className="text-sm font-semibold text-red-500">HISTORICAL</span>
                        </>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="whitespace-pre-line">{tooltipContent}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {lastUpdateText}
            </p>
          </div>
          {isLive ? (
            <Wifi className="w-8 h-8 text-green-500" />
          ) : (
            <Database className="w-8 h-8 text-red-500" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

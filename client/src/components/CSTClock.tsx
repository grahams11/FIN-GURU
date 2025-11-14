import { Clock, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCstTime } from "@/hooks/use-cst-time";

export function CSTClock() {
  const { formattedTime, isMarketOpen } = useCstTime();

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              CST Time
            </p>
            <p className="text-2xl font-bold" data-testid="text-cst-time">
              {formattedTime}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <Circle 
                className={`w-2 h-2 fill-current ${isMarketOpen ? 'text-green-500' : 'text-red-500'}`}
              />
              <p 
                className={`text-sm font-semibold ${isMarketOpen ? 'text-green-500' : 'text-red-500'}`}
                data-testid="text-market-status"
              >
                {isMarketOpen ? 'MARKET LIVE' : 'MARKET CLOSED'}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

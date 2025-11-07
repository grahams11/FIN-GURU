import { useState, useEffect, useRef } from 'react';

interface Quote {
  price: number;
  bid: number;
  ask: number;
  volume: number;
  timestamp: number;
}

type QuotesMap = Record<string, Quote>;

export function useLiveQuotes(symbols: string[] = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'META']) {
  const [quotes, setQuotes] = useState<QuotesMap>({});
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (symbols.length === 0) return;

    const symbolsParam = symbols.join(',');
    const eventSource = new EventSource(`/api/quotes/stream?symbols=${symbolsParam}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('📡 SSE connection opened');
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data: QuotesMap = JSON.parse(event.data);
        setQuotes(prevQuotes => ({
          ...prevQuotes,
          ...data
        }));
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      setIsConnected(false);
    };

    return () => {
      console.log('📡 Closing SSE connection');
      eventSource.close();
      setIsConnected(false);
    };
  }, [symbols.join(',')]);

  return { quotes, isConnected };
}

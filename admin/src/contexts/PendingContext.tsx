import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../lib/api';

interface Pending {
  openTickets: number;
  openReports: number;
  sightingsPending: number;
}

interface PendingState extends Pending {
  refresh: () => void;
}

const PendingContext = createContext<PendingState>({
  openTickets: 0,
  openReports: 0,
  sightingsPending: 0,
  refresh: () => {},
});

export function PendingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Pending>({
    openTickets: 0,
    openReports: 0,
    sightingsPending: 0,
  });

  const refresh = useCallback(() => {
    api
      .overview()
      .then((o) =>
        setData({
          openTickets: o.openTickets ?? 0,
          openReports: o.openReports ?? 0,
          sightingsPending: o.sightingsPending ?? 0,
        })
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60000); // atualiza a cada 1 min
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <PendingContext.Provider value={{ ...data, refresh }}>{children}</PendingContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const usePending = () => useContext(PendingContext);

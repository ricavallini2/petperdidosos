import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { api } from '../lib/api';
import { toast } from '../lib/ui';

interface Pending {
  openTickets: number;
  openReports: number;
  sightingsPending: number;
}

interface PendingState extends Pending {
  total: number;
  refresh: () => void;
}

const PendingContext = createContext<PendingState>({
  openTickets: 0,
  openReports: 0,
  sightingsPending: 0,
  total: 0,
  refresh: () => {},
});

const BASE_TITLE = 'PetPerdidoSOS — Admin';

export function PendingProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Pending>({
    openTickets: 0,
    openReports: 0,
    sightingsPending: 0,
  });
  // Guarda a leitura anterior para detectar novidades entre as atualizações
  const prev = useRef<Pending | null>(null);

  const refresh = useCallback(() => {
    api
      .overview()
      .then((o) => {
        const next: Pending = {
          openTickets: o.openTickets ?? 0,
          openReports: o.openReports ?? 0,
          sightingsPending: o.sightingsPending ?? 0,
        };
        // Avisa só quando algo NOVO chega (não no primeiro carregamento)
        if (prev.current) {
          if (next.openReports > prev.current.openReports) {
            toast.info('Nova denúncia recebida.');
          }
          if (next.openTickets > prev.current.openTickets) {
            toast.info('Novo chamado de suporte.');
          }
          if (next.sightingsPending > prev.current.sightingsPending) {
            toast.info('Novo avistamento para revisar.');
          }
        }
        prev.current = next;
        setData(next);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 45000); // atualiza a cada 45s
    return () => clearInterval(timer);
  }, [refresh]);

  const total = data.openTickets + data.openReports + data.sightingsPending;

  // Reflete as pendências no título da aba do navegador
  useEffect(() => {
    document.title = total > 0 ? `(${total}) ${BASE_TITLE}` : BASE_TITLE;
  }, [total]);

  return (
    <PendingContext.Provider value={{ ...data, total, refresh }}>
      {children}
    </PendingContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const usePending = () => useContext(PendingContext);

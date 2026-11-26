import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import { TelaHeader } from '@/components/TelaHeader';
import { RodapeSistema } from '@/components/RodapeSistema';
import { MeusDadosModal } from './MeusDadosModal';
import { DbConnectionStatus, Empresa, ServidorInfo, Usuario } from '../types';

/**
 * Casca das telas logadas, como no erp-compras: menu, cabeçalho e barra de status ficam aqui,
 * uma vez só, e não são refeitos ao trocar de opção. Cada tela desenha apenas o conteúdo.
 */

const TELAS: Record<string, { titulo: string; subtitulo: string }> = {
  '/calcpv': { titulo: 'Calcular PV', subtitulo: 'Preço de venda pelos produtos das compras, com IPI, frete, ST e markup' },
};

/** O botão de recarregar do cabeçalho chama o que a tela ativa registrou */
const RefreshCtx = createContext<{ registrar: (fn: (() => void) | null) => void }>({ registrar: () => {} });

/** A tela registra como se recarrega (o botão só aparece nas que registram) */
export function useRefreshDaTela(fn: () => void) {
  const { registrar } = useContext(RefreshCtx);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    registrar(() => ref.current());
    return () => registrar(null);
  }, [registrar]);
}

interface LayoutAppProps {
  usuario: Usuario;
  empresa: Empresa;
  servidor: ServidorInfo;
  dbStatus: DbConnectionStatus | null;
  onLogout: () => void;
  onUsuarioAtualizado: (dados: Partial<Usuario>) => void;
}

export const LayoutApp: React.FC<LayoutAppProps> = ({ usuario, empresa, servidor, dbStatus, onLogout, onUsuarioAtualizado }) => {
  const { pathname } = useLocation();
  const [meusDadosAberto, setMeusDadosAberto] = useState(false);
  const [refresh, setRefresh] = useState<(() => void) | null>(null);
  const registrar = useCallback((fn: (() => void) | null) => setRefresh(() => fn), []);

  const tela = TELAS[pathname] ?? { titulo: '', subtitulo: '' };

  return (
    <RefreshCtx.Provider value={{ registrar }}>
      <div className="min-h-screen bg-elegant-bg font-sans text-elegant-text antialiased selection:bg-marca-500 selection:text-white">
        <Sidebar usuario={usuario} onOpenMeusDados={() => setMeusDadosAberto(true)} onLogout={onLogout} />
        <div className="lg:ml-[var(--larg-menu)] h-screen flex flex-col min-w-0 overflow-hidden print:h-auto print:overflow-visible print:ml-0">
          <TelaHeader
            titulo={tela.titulo}
            subtitulo={tela.subtitulo}
            empresaNome={empresa.fantasia || empresa.nome}
            onRefresh={refresh ?? undefined}
          />
          <div className="flex-1 min-h-0 flex flex-col print:block">
            <Outlet />
          </div>
          <RodapeSistema empresa={empresa} servidor={servidor} usuario={usuario} dbStatus={dbStatus} />
        </div>
      </div>

      {meusDadosAberto && (
        <MeusDadosModal
          isOpen={meusDadosAberto}
          onClose={() => setMeusDadosAberto(false)}
          usuario={usuario}
          onUsuarioAtualizado={onUsuarioAtualizado}
        />
      )}
    </RefreshCtx.Provider>
  );
};

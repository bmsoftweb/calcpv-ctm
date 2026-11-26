import React, { useState, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { DbConnectionStatus, Usuario } from './types';
import {
  lerSessao,
  salvarSessao,
  limparSessao,
  atualizarSessao,
  SessaoSalva,
} from './utils/session';
import { setTokenSessao, onSessaoExpirada, fetchDbStatus } from './services/api';
import { LoginView } from './components/LoginView';
import { LayoutApp } from './components/LayoutApp';
import { CalcPvView } from './components/CalcPvView';

/** Telas do menu; a página inicial do usuário (WEB_USUARIOS.PAGINA_INICIAL) usa estas mesmas chaves */
const TELAS = ['calcpv'];

export const App: React.FC = () => {
  // O token precisa valer já na primeira renderização: os efeitos das telas rodam antes
  // do efeito do App e, sem ele, a primeira consulta volta 401 e derruba a sessão.
  const [sessao, setSessao] = useState<SessaoSalva | null>(() => {
    const salva = lerSessao();
    setTokenSessao(salva?.token ?? null);
    return salva;
  });
  const [dbStatus, setDbStatus] = useState<DbConnectionStatus | null>(null);

  useEffect(() => {
    setTokenSessao(sessao?.token ?? null);
  }, [sessao?.token]);

  // Handler de expiração de token (401)
  useEffect(() => {
    onSessaoExpirada((motivo) => {
      console.warn('Sessão expirada:', motivo);
      limparSessao();
      setSessao(null);
      setTokenSessao(null);
    });
  }, []);

  // Monitora status da conexão com a bmAPI
  const atualizarStatus = async () => {
    if (!sessao?.token) return;
    try {
      setDbStatus(await fetchDbStatus());
    } catch {
      setDbStatus(null);
    }
  };

  useEffect(() => {
    if (!sessao?.token) return;
    atualizarStatus();
    const interval = setInterval(atualizarStatus, 30000);
    return () => clearInterval(interval);
  }, [sessao?.token]);

  // Se não estiver autenticado, exibe a tela de login
  if (!sessao || !sessao.token) {
    return (
      <LoginView
        onLoginSuccess={(dados) => {
          const novaSessao: SessaoSalva = {
            token: dados.token,
            usuario: dados.usuario,
            empresa: dados.empresa,
            servidor: dados.servidor,
          };
          salvarSessao(novaSessao, dados.lembrar);
          setTokenSessao(dados.token);
          setSessao(novaSessao);
        }}
      />
    );
  }

  const inicial = TELAS.includes(sessao.usuario.paginaInicial) ? sessao.usuario.paginaInicial : 'calcpv';

  const sair = () => {
    limparSessao();
    setSessao(null);
    setTokenSessao(null);
  };

  const trocarUsuario = (dados: Partial<Usuario>) => {
    const usuario = { ...sessao.usuario, ...dados };
    atualizarSessao({ usuario });
    setSessao({ ...sessao, usuario });
  };

  return (
    <Routes>
      <Route
        element={
          <LayoutApp
            usuario={sessao.usuario}
            empresa={sessao.empresa}
            servidor={sessao.servidor}
            dbStatus={dbStatus}
            onLogout={sair}
            onUsuarioAtualizado={trocarUsuario}
          />
        }
      >
        <Route path="/calcpv" element={<CalcPvView />} />
      </Route>
      <Route path="*" element={<Navigate to={`/${inicial}`} replace />} />
    </Routes>
  );
};

export default App;

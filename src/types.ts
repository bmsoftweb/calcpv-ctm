// =====================================================================
// Tipos do CalcPV-CTM
// =====================================================================

export interface Usuario {
  id: number;
  idPessoa: number;
  idEmpresa: number;
  nome: string;
  email: string;
  nomePessoa: string;
  nivel: 'A' | 'G' | 'S' | 'V' | 'C';
  nivelDescricao: string;
  listaPreco: string;
  paginaInicial: string;
}

export interface Empresa {
  id: number;
  nome: string;
  fantasia: string;
  apelido: string;
  cnpj: string;
  cidade: string;
  uf: string;
}

export interface ServidorInfo {
  numero: number;
  identificacao: string;
}

export interface DbConnectionStatus {
  connected: boolean;
  latencyMs: number;
  servidor: number;
  identificacao: string;
  empresa?: string | null;
  error?: string;
}

export interface ConfigPublica {
  idEmpresa: number;
}

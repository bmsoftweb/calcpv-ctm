import { DbConnectionStatus, Usuario, Empresa, ServidorInfo } from '../types';

/**
 * O token de sessão acompanha toda requisição no header Authorization.
 * A chave da bmAPI fica só no servidor.
 */
let tokenAtual: string | null = null;
let aoExpirar: ((motivo: string) => void) | null = null;

export function setTokenSessao(token: string | null) {
  tokenAtual = token;
}

/** Chamado quando o servidor recusa a sessão (401), para voltar ao login */
export function onSessaoExpirada(fn: (motivo: string) => void) {
  aoExpirar = fn;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (tokenAtual) h.Authorization = `Bearer ${tokenAtual}`;
  return h;
}

async function parseOrThrow(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || `Falha na requisição (HTTP ${res.status}).`;
    if (res.status === 401 && tokenAtual && aoExpirar) aoExpirar(msg);
    throw new Error(msg);
  }
  return data;
}

async function get<T = any>(url: string): Promise<T> {
  return parseOrThrow(await fetch(url, { headers: headers() }));
}

async function send<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  return parseOrThrow(
    await fetch(url, {
      method,
      headers: headers({ 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

// ------------------------------------------------------------
// Autenticação
// ------------------------------------------------------------
/** `token` é o X-API-Key do servidor do cliente, digitado no login */
export async function login(
  token: string,
  email: string,
  senha: string,
): Promise<{ token: string; usuario: Usuario; empresa: Empresa; servidor: ServidorInfo }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, email, senha }),
  });
  return parseOrThrow(res);
}

/** Confere o token e devolve a identificação do servidor (POST: token não vai na URL) */
export async function consultarServidor(token: string): Promise<{ numero: number; identificacao: string; connected: boolean; error?: string }> {
  const res = await fetch('/api/servidores/verificar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return parseOrThrow(res);
}

export async function validarSessao(): Promise<{ usuario: Usuario; empresa: Empresa; servidor: ServidorInfo }> {
  return get('/api/auth/sessao');
}

export async function salvarMeusDados(dados: { email: string; paginaInicial: string; senha?: string; senhaConfirma?: string }): Promise<void> {
  await send('PUT', '/api/auth/meus-dados', dados);
}

// ------------------------------------------------------------
// Status da bmAPI
// ------------------------------------------------------------
export async function fetchDbStatus(): Promise<DbConnectionStatus> {
  return get('/api/db/status');
}


// ------------------------------------------------------------
// Calcular PV
// ------------------------------------------------------------
export interface CompraPv {
  id: number;
  numero: number;
  serie: string;
  cfop: string;
  dataEmissao: string | null;
  dataEntrada: string | null;
  total: number;
  /** itens da nota com produto */
  produtos: number;
  idFornecedor: number;
  fornecedor: string;
  /** PESSOAS.TIPO_CREDIARIO = 'S': fornecedor cujas notas não precisam ser listadas */
  fornecedorOculto: boolean;
  /** ENTRADASM.TP_ASSINANTE: '' não calculada, 'P' parcial, 'C' calculada */
  situacao: string;
}

export interface ItemCompraPv {
  id: number;
  item: number;
  idPro: number;
  descricao: string;
  qtd: number;
  un: string;
  custo: number;
  total: number;
  pvAtual: number;
  /** ENTRADASPRODUTOS.OP_FLAG = 'C' */
  calculado: boolean;
}

/** Compras (ENTRADASM) com data de entrada no período (yyyy-mm-dd), a mais recente primeiro */
export async function fetchComprasPv(d1: string, d2: string): Promise<CompraPv[]> {
  return get(`/api/calcpv/compras?d1=${d1}&d2=${d2}`);
}

/** Marca/desmarca o fornecedor cujas notas não precisam aparecer na lista de compras */
export async function ocultarFornecedorPv(idFornecedor: number, ocultar: boolean): Promise<void> {
  await send('PUT', `/api/calcpv/fornecedores/${idFornecedor}`, { ocultar });
}

/** Produtos da compra (ENTRADASPRODUTOS) */
export async function fetchItensCompraPv(idCompra: number): Promise<ItemCompraPv[]> {
  return get(`/api/calcpv/compras/${idCompra}/itens`);
}

export async function fetchCustoPv(idPro: number): Promise<{ custo: number; ipi: number; frete: number; st: number; markupAtual: number; qtdCompras: number; pvAtual: number; nota: number | null; dataEntrada: string | null; ultimasCompras: { dataEntrada: string | null; fornecedor: string; custo: number }[] }> {
  return get(`/api/calcpv/custo/${idPro}`);
}

export interface ProdutoPv {
  id: number;
  descricao: string;
  marca: string;
  classe: string;
  un: string;
  markup: number;
  pvAtual: number;
}

/** Produtos ativos por código/descrição, marca e classe, para calcular o PV sem abrir uma compra */
export async function fetchProdutosPv(f: { q?: string; marca?: string; classe?: string }): Promise<ProdutoPv[]> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v?.trim()) p.set(k, v.trim());
  return get(`/api/calcpv/produtos?${p}`);
}

/** Marcas e classes para as listas da pesquisa de produtos */
export async function fetchFiltrosProdutosPv(): Promise<{ marcas: string[]; classes: string[] }> {
  return get('/api/calcpv/filtros-produtos');
}

/** Grava o markup (LUCRO_VENDA_P1) e o PV (PRECOVENDA1); com a compra, marca os itens e devolve a situação dela */
export async function salvarPv(idPro: number, markup: number, pv: number, idCompra?: number): Promise<{ situacao?: string }> {
  return send('PUT', `/api/calcpv/produtos/${idPro}`, { markup, pv, idCompra });
}

/** Grava no produto quantas últimas compras entram no custo (PRODUTOSPRINCIPAL.DENSIDADE) */
export async function salvarQtdComprasPv(idPro: number, qtd: number): Promise<void> {
  await send('PUT', `/api/calcpv/produtos/${idPro}/compras`, { qtd });
}

/** Marca (ou desmarca) o produto como calculado na compra sem gravar preço; devolve a nova situação da compra */
export async function marcarCalculadoPv(idCompra: number, idPro: number, calculado: boolean): Promise<{ situacao: string }> {
  return send('PUT', `/api/calcpv/compras/${idCompra}/produtos/${idPro}/calculado`, { calculado });
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Calculator, CheckCheck, Eye, EyeOff, Loader2, Minus, Plus, Save, Search, Undo2 } from 'lucide-react';
import { fetchProdutosPv, fetchFiltrosProdutosPv, ProdutoPv, fetchComprasPv, fetchItensCompraPv, fetchCustoPv, salvarPv, salvarQtdComprasPv, marcarCalculadoPv, ocultarFornecedorPv, CompraPv, ItemCompraPv } from '../services/api';
import { formatCurrencyBRL, formatDateBR, formatDecimal, formatQtd, hojeISO } from '../utils/formatters';
import { useRefreshDaTela } from '@/components/LayoutApp';
import { ListaCrm } from '@/components/ListaCrm';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/FormCrm';
import { BotaoAcao } from '@/components/MenuAcoes';
import { AvisoErro } from '@/components/AvisoErro';
import { NumberField } from './NumberField';
import { Toggle } from './Toggle';
import { CampoLista } from './CampoLista';
import { DateField } from './DateField';

/** Custo total = custo × (1 + %IPI + %frete + %ST); PV = custo total × (1 + markup%). Ex.: 100 com markup 80% = 180,00 */
export function calcularPv(custo: number, ipi: number, frete: number, st: number, markup: number) {
  const custoTotal = custo * (1 + (ipi + frete + st) / 100);
  return { custoTotal, pv: custoTotal * (1 + markup / 100) };
}

const Campo: React.FC<{ rotulo: string; children: React.ReactNode }> = ({ rotulo, children }) => (
  <label className="flex flex-col gap-1">
    <span className={LABEL_CLASS}>{rotulo}</span>
    {children}
  </label>
);

const Resultado: React.FC<{ rotulo: string; valor: number; destaque?: boolean }> = ({ rotulo, valor, destaque }) => (
  <div className={`flex items-center justify-between rounded-md px-3 py-2 ${destaque ? 'bg-marca-50 dark:bg-marca-950/40' : 'bg-stone-50 dark:bg-stone-800/60'}`}>
    <span className={LABEL_CLASS}>{rotulo}</span>
    <span className={`font-mono ${destaque ? 'text-lg font-bold text-marca-700 dark:text-marca-300' : 'text-sm font-semibold text-stone-800 dark:text-stone-100'}`}>
      {formatCurrencyBRL(valor)}
    </span>
  </div>
);

/** Situação do cálculo: '' não calculada, 'P' parcial, 'C' calculada (ENTRADASM.TP_ASSINANTE / ENTRADASPRODUTOS.OP_FLAG) */
const SITUACAO: Record<string, { texto: string; cor: string }> = {
  '': { texto: 'Não calculada', cor: 'text-stone-400' },
  P: { texto: 'Parcial', cor: 'font-semibold text-amber-600 dark:text-amber-400' },
  C: { texto: 'Calculada', cor: 'font-semibold text-emerald-700 dark:text-emerald-400' },
};
const Situacao: React.FC<{ valor: string }> = ({ valor }) => {
  const s = SITUACAO[valor] ?? SITUACAO[''];
  return <span className={s.cor}>{s.texto}</span>;
};

const notaTexto = (c: CompraPv) => `NF ${c.numero}${c.serie ? `/${c.serie}` : ''} de ${formatDateBR(c.dataEntrada)}`;

/**
 * Painel à direita: custo do item na compra aberta; % IPI, frete e ST de PROCUSTOSEMP.
 * O markup vem do gravado no produto (LUCRO_VENDA_P1); sem ele, fica o digitado no produto anterior.
 */
const PainelPv: React.FC<{
  item: ItemCompraPv | null;
  /** sem compra (produto pesquisado pelo código): grava só o preço, sem marcar nota */
  idCompra?: number;
  onErro: (m: string) => void;
  onGravado: (item: ItemCompraPv, pv: number, situacao: string) => void;
  /** marca o produto como calculado mantendo o preço atual do cadastro (só com compra) */
  onManter?: (item: ItemCompraPv) => void;
}> = ({ item, idCompra, onErro, onGravado, onManter }) => {
  const [carregando, setCarregando] = useState(false);
  const [v, setV] = useState({ custo: '', ipi: '', frete: '', st: '', markup: '' });
  const [salvando, setSalvando] = useState(false);
  /** PV acertado à mão (null = o calculado); ao acertar, o markup é recalculado a partir dele */
  const [pvAjustado, setPvAjustado] = useState<string | null>(null);
  /** compras do produto vindas do servidor (até 20); a lista mostra as `qtdUltimas` primeiras */
  const [compras, setCompras] = useState<{ dataEntrada: string | null; fornecedor: string; custo: number }[]>([]);
  /** quantas últimas compras entram no custo: gravado por produto (DENSIDADE), padrão 4 */
  const [qtdUltimas, setQtdUltimas] = useState(4);
  const gravarQtd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ultimas = compras.slice(0, qtdUltimas);
  /** maior custo entre as `qtd` últimas compras; sem histórico, o custo do item nesta nota */
  const custoBase = (lista: typeof compras, qtd: number) => {
    const l = lista.slice(0, qtd);
    return (l.length ? Math.max(...l.map((u) => u.custo)) : (item?.custo ?? 0)).toFixed(2);
  };
  const mudaQtdUltimas = (qtd: number) => {
    const q = Math.min(Math.max(qtd, 1), 20);
    setQtdUltimas(q);
    setPvAjustado(null);
    setV((s) => ({ ...s, custo: custoBase(compras, q) }));
    // grava no produto depois que o usuário para de clicar no spin
    if (!item) return;
    const idPro = item.idPro;
    clearTimeout(gravarQtd.current);
    gravarQtd.current = setTimeout(() => {
      salvarQtdComprasPv(idPro, q).catch((e) => onErro(e.message || 'Erro ao gravar o número de compras do produto.'));
    }, 600);
  };

  useEffect(() => {
    if (!item) return;
    setPvAjustado(null);
    let valido = true; // descarta a resposta de um produto que já foi trocado
    setCarregando(true);
    fetchCustoPv(item.idPro)
      .then((c) => {
        if (!valido) return;
        const qtd = c.qtdCompras > 0 ? Math.min(c.qtdCompras, 20) : 4;
        setCompras(c.ultimasCompras);
        setQtdUltimas(qtd);
        setV((s) => ({
          ...s,
          custo: custoBase(c.ultimasCompras, qtd),
          ipi: c.ipi.toFixed(2),
          frete: c.frete.toFixed(2),
          st: c.st.toFixed(2),
          markup: c.markupAtual > 0 ? c.markupAtual.toFixed(2) : s.markup,
        }));
      })
      .catch((e) => valido && onErro(e.message || 'Erro ao buscar os percentuais do produto.'))
      .finally(() => valido && setCarregando(false));
    return () => {
      valido = false;
    };
  }, [item?.id, onErro]);

  const n = (s: string) => Number(s) || 0;
  const maiorCusto = ultimas.length ? Math.max(...ultimas.map((u) => u.custo)) : null;
  const { custoTotal, pv } = calcularPv(n(v.custo), n(v.ipi), n(v.frete), n(v.st), n(v.markup));
  const muda = (k: keyof typeof v) => (valor: string) => {
    setPvAjustado(null);
    setV((s) => ({ ...s, [k]: valor }));
  };
  const mudaPv = (valor: string) => {
    setPvAjustado(valor);
    if (custoTotal > 0) setV((s) => ({ ...s, markup: ((n(valor) / custoTotal - 1) * 100).toFixed(2) }));
  };
  const pvGravar = Math.round((pvAjustado !== null ? n(pvAjustado) : pv) * 100) / 100;

  const gravar = async () => {
    if (!item) return;
    setSalvando(true);
    try {
      const r = await salvarPv(item.idPro, n(v.markup), pvGravar, Math.round(custoTotal * 100) / 100, idCompra);
      onGravado(item, pvGravar, r.situacao ?? '');
    } catch (e: any) {
      onErro(e.message || 'Erro ao gravar o preço de venda.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <aside className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 flex flex-col min-h-0">
      <div className="px-4 py-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-800/40">
        <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-marca-600 dark:text-marca-400" /> Calcular PV
        </h3>
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 truncate" title={item ? item.descricao : undefined}>
          {item ? `#${item.idPro} — ${item.descricao}` : 'Escolha um produto da compra'}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!item ? (
          <p className="text-xs text-stone-400 text-center py-8">Clique num produto para calcular o preço de venda.</p>
        ) : carregando ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-stone-500">
            <Loader2 className="w-4 h-4 animate-spin text-marca-500" /> Buscando os dados do produto…
          </div>
        ) : (
          <div className="space-y-3">
            <Campo rotulo="Preço de custo">
              <NumberField scale={2} value={v.custo} onChange={muda('custo')} className={INPUT_CLASS} />
            </Campo>
            <p className="-mt-2 text-[11px] text-stone-400">Maior custo das últimas compras</p>
            <div className="grid grid-cols-3 gap-3">
              <Campo rotulo="% IPI">
                <NumberField scale={2} value={v.ipi} onChange={muda('ipi')} className={INPUT_CLASS} />
              </Campo>
              <Campo rotulo="% Frete">
                <NumberField scale={2} value={v.frete} onChange={muda('frete')} className={INPUT_CLASS} />
              </Campo>
              <Campo rotulo="% ST">
                <NumberField scale={2} value={v.st} onChange={muda('st')} className={INPUT_CLASS} />
              </Campo>
            </div>
            <Resultado rotulo="Custo total" valor={custoTotal} />
            <Campo rotulo="% Markup">
              <NumberField scale={2} required allowNegative value={v.markup} onChange={muda('markup')} className={INPUT_CLASS} autoFocus />
            </Campo>
            <Campo rotulo="Preço de venda">
              <NumberField scale={2} required value={pvAjustado ?? pvGravar.toFixed(2)} onChange={mudaPv} className={`${INPUT_CLASS} !text-lg !font-bold text-marca-700 dark:text-marca-300`} />
            </Campo>
            {pvAjustado !== null && (
              <p className="-mt-2 text-[11px] text-stone-400">Preço acertado à mão; o markup foi recalculado.</p>
            )}
            <p className="text-[11px] text-stone-400 text-right -mt-2">Preço atual no cadastro: {formatCurrencyBRL(item.pvAtual)}</p>
            <button
              type="button"
              onClick={gravar}
              disabled={salvando || pvGravar <= 0}
              className="w-full h-9 text-xs font-semibold text-white bg-marca-600 hover:bg-marca-700 active:bg-marca-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
            >
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Gravar markup e preço de venda
            </button>
            {onManter && !item.calculado && (
              <button
                type="button"
                onClick={() => onManter(item)}
                title="Marca o produto como calculado nesta compra sem alterar o preço do cadastro"
                className="w-full h-9 -mt-1 text-xs font-semibold text-marca-700 dark:text-marca-300 border border-marca-200 dark:border-marca-800 hover:bg-marca-50 dark:hover:bg-marca-950/40 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
                Manter preço atual ({formatCurrencyBRL(item.pvAtual)})
              </button>
            )}
            <div className="pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className={LABEL_CLASS}>Últimas compras do produto</p>
                {/* spin: quantas compras entram na lista (e no maior custo) */}
                <div className="flex items-center rounded-md border border-stone-200 dark:border-stone-700 overflow-hidden" title="Quantas compras mostrar (o custo é o maior entre elas)">
                  <button type="button" onClick={() => mudaQtdUltimas(qtdUltimas - 1)} disabled={qtdUltimas <= 1} className="w-6 h-6 flex items-center justify-center text-stone-500 hover:bg-marca-50 hover:text-marca-700 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed dark:hover:bg-marca-950/40" title="Mostrar uma compra a menos">
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center text-[11px] font-semibold text-stone-700 dark:text-stone-200 tabular-nums">{qtdUltimas}</span>
                  <button type="button" onClick={() => mudaQtdUltimas(qtdUltimas + 1)} disabled={qtdUltimas >= 20} className="w-6 h-6 flex items-center justify-center text-stone-500 hover:bg-marca-50 hover:text-marca-700 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed dark:hover:bg-marca-950/40" title="Mostrar uma compra a mais">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {ultimas.length === 0 ? (
                <p className="text-[11px] text-stone-400">Nenhuma compra encontrada.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-stone-500 dark:text-stone-400 border-b border-stone-200 dark:border-stone-800">
                      <th className="py-1 pr-2 font-semibold text-center">Data</th>
                      <th className="py-1 pr-2 font-semibold text-left">Fornecedor</th>
                      <th className="py-1 font-semibold text-right">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ultimas.map((u, i) => (
                      <tr key={i} className={`border-b border-stone-100 dark:border-stone-800/60 ${u.custo === maiorCusto ? 'font-semibold text-marca-700 dark:text-marca-300' : 'text-stone-700 dark:text-stone-300'}`}>
                        <td className="py-1.5 pr-2 text-center whitespace-nowrap">{formatDateBR(u.dataEntrada)}</td>
                        <td className="py-1.5 pr-2 max-w-0 w-full truncate" title={u.fornecedor}>{u.fornecedor || '—'}</td>
                        <td className="py-1.5 text-right font-mono whitespace-nowrap">{formatDecimal(u.custo, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

/**
 * Duas "abas" sem orelha, como no MDI: as últimas compras e os produtos da compra escolhida.
 * As duas ficam montadas (só a ativa aparece), então voltar às compras não perde a posição.
 */
export const CalcPvView: React.FC = () => {
  const [aba, setAba] = useState<'compras' | 'itens' | 'produto'>('compras');
  /** pesquisa de produtos (código/descrição, marca, classe), sem passar pelas compras */
  const [pq, setPq] = useState('');
  const [pMarca, setPMarca] = useState('');
  const [pClasse, setPClasse] = useState('');
  const [opcoes, setOpcoes] = useState<{ marcas: string[]; classes: string[] } | null>(null);
  const [produtos, setProdutos] = useState<ProdutoPv[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [produto, setProduto] = useState<ItemCompraPv | null>(null);
  const [d1, setD1] = useState(() => hojeISO(-30));
  const [d2, setD2] = useState(() => hojeISO());
  const [compras, setCompras] = useState<CompraPv[]>([]);
  const [fornecedor, setFornecedor] = useState('');
  /** '' todas, 'pend' não calculadas + parciais, 'N' não calculadas, 'P' parciais, 'C' calculadas */
  const [situacao, setSituacao] = useState('');
  /** Mostra também as notas dos fornecedores marcados para não listar */
  const [verOcultos, setVerOcultos] = useState(false);
  const [carregandoCompras, setCarregandoCompras] = useState(true);
  const [compra, setCompra] = useState<CompraPv | null>(null);
  const [itens, setItens] = useState<ItemCompraPv[]>([]);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [item, setItem] = useState<ItemCompraPv | null>(null);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  const carregarCompras = useCallback(async () => {
    if (!d1 || !d2) return;
    try {
      setCarregandoCompras(true);
      setCompras(await fetchComprasPv(d1, d2));
    } catch (err: any) {
      setErro(err.message || 'Erro ao carregar as compras.');
    } finally {
      setCarregandoCompras(false);
    }
  }, [d1, d2]);

  const carregarItens = useCallback(async (c: CompraPv, abrirPrimeiro = false) => {
    try {
      setCarregandoItens(true);
      const lista = await fetchItensCompraPv(c.id);
      setItens(lista);
      // ao abrir a nota, o cálculo já vem no 1º item com produto
      if (abrirPrimeiro) setItem(lista.find((i) => i.idPro > 0) ?? null);
    } catch (err: any) {
      setErro(err.message || 'Erro ao carregar os produtos da compra.');
    } finally {
      setCarregandoItens(false);
    }
  }, []);

  useEffect(() => void carregarCompras(), [carregarCompras]);

  const comprasVisiveis = useMemo(() => (verOcultos ? compras : compras.filter((c) => !c.fornecedorOculto)), [compras, verOcultos]);
  // Fornecedores das compras do período, para o filtro
  const fornecedores = useMemo(() => [...new Set(comprasVisiveis.map((c) => c.fornecedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [comprasVisiveis]);
  const comprasFiltradas = comprasVisiveis.filter(
    (c) =>
      (!fornecedor || c.fornecedor.toLocaleLowerCase('pt-BR').includes(fornecedor.trim().toLocaleLowerCase('pt-BR'))) &&
      (!situacao || (situacao === 'pend' ? c.situacao !== 'C' : (c.situacao || 'N') === situacao)),
  );
  useRefreshDaTela(() => (aba === 'compras' ? carregarCompras() : compra && carregarItens(compra)));

  const abrirCompra = (c: CompraPv) => {
    setAba('itens');
    if (c.id === compra?.id) return;
    setCompra(c);
    setItem(null);
    setItens([]);
    carregarItens(c, true);
  };

  const ocultarFornecedor = async (c: CompraPv, ocultar: boolean) => {
    try {
      await ocultarFornecedorPv(c.idFornecedor, ocultar);
      setCompras((lista) => lista.map((x) => (x.idFornecedor === c.idFornecedor ? { ...x, fornecedorOculto: ocultar } : x)));
      if (ocultar && c.fornecedor === fornecedor) setFornecedor('');
      setSucesso(ocultar ? `As notas de "${c.fornecedor}" não serão mais listadas.` : `As notas de "${c.fornecedor}" voltam a ser listadas.`);
    } catch (err: any) {
      setErro(err.message || 'Erro ao gravar o fornecedor.');
    }
  };

  /** Marca/desmarca o produto como calculado na compra sem gravar preço (preço do cadastro fica como está) */
  const marcarCalculado = async (it: ItemCompraPv, calculado: boolean) => {
    if (!compra) return;
    try {
      const { situacao } = await marcarCalculadoPv(compra.id, it.idPro, calculado);
      setItens((lista) => lista.map((x) => (x.idPro === it.idPro ? { ...x, calculado } : x)));
      setItem((x) => (x && x.idPro === it.idPro ? { ...x, calculado } : x));
      setCompras((lista) => lista.map((c) => (c.id === compra.id ? { ...c, situacao } : c)));
      setCompra((c) => (c ? { ...c, situacao } : c));
      setSucesso(calculado ? `"${it.descricao}" marcado como calculado (preço mantido).` : `"${it.descricao}" voltou a ficar pendente.`);
    } catch (err: any) {
      setErro(err.message || 'Erro ao marcar o produto.');
    }
  };

  // listas de marcas e classes: carregadas na primeira vez que a pesquisa de produtos abre
  useEffect(() => {
    if (aba !== 'produto' || opcoes) return;
    fetchFiltrosProdutosPv()
      .then(setOpcoes)
      .catch((e) => setErro(e.message || 'Erro ao carregar as marcas e classes.'));
  }, [aba, opcoes]);

  const comoItem = (p: ProdutoPv): ItemCompraPv => ({ id: p.id, item: 0, idPro: p.id, descricao: p.descricao, qtd: 0, un: p.un, custo: 0, total: 0, pvAtual: p.pvAtual, calculado: false });

  /** Abre a pesquisa de produtos; com algum filtro, já pesquisa e abre o cálculo do 1º */
  const pesquisarProdutos = async () => {
    setAba('produto');
    if (!pq.trim() && !pMarca.trim() && !pClasse.trim()) return;
    try {
      setBuscando(true);
      const lista = await fetchProdutosPv({ q: pq, marca: pMarca, classe: pClasse });
      setProdutos(lista);
      setProduto(lista[0] ? comoItem(lista[0]) : null);
    } catch (err: any) {
      setErro(err.message || 'Erro ao pesquisar os produtos.');
    } finally {
      setBuscando(false);
    }
  };

  const campoPesquisa = (
    <input
      value={pq}
      onChange={(e) => setPq(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && pesquisarProdutos()}
      placeholder="Código ou descrição"
      title="Pesquisar produtos pelo código ou parte da descrição, sem abrir uma compra (Enter pesquisa)"
      className={`${INPUT_CLASS} !w-44`}
    />
  );
  const botaoPesquisa = (
    <button
      type="button"
      onClick={pesquisarProdutos}
      disabled={buscando}
      title="Pesquisar produtos"
      className="h-[34px] w-[34px] shrink-0 rounded-md border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center justify-center cursor-pointer disabled:opacity-50"
    >
      {buscando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
    </button>
  );

  const gravado = (it: ItemCompraPv, pv: number, situacao: string) => {
    // O mesmo produto pode aparecer em mais de um item da nota: todos ficam calculados
    setItens((lista) => lista.map((x) => (x.idPro === it.idPro ? { ...x, pvAtual: pv, calculado: true } : x)));
    setItem((x) => (x && x.idPro === it.idPro ? { ...x, pvAtual: pv, calculado: true } : x));
    setCompras((lista) => lista.map((c) => (c.id === compra?.id ? { ...c, situacao } : c)));
    setCompra((c) => (c ? { ...c, situacao } : c));
    setSucesso(`Preço de venda de "${it.descricao}" gravado: ${formatCurrencyBRL(pv)}.`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className={aba === 'compras' ? 'flex-1 flex flex-col min-h-0 min-w-0' : 'hidden'}>
        <ListaCrm
          className="flex-1 min-w-0"
          id="calcpv-compras"
          linhas={comprasFiltradas}
          carregando={carregandoCompras}
          chave={(c) => c.id}
          onEditar={(c: CompraPv) => abrirCompra(c)}
          barraExtra={
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1 shrink-0">
                {campoPesquisa}
                {botaoPesquisa}
              </div>
              <span className="text-[11px] text-stone-400">Entrada de</span>
              <div className="w-36">
                <DateField value={d1} onChange={setD1} required className={INPUT_CLASS} />
              </div>
              <span className="text-[11px] text-stone-400">até</span>
              <div className="w-36">
                <DateField value={d2} onChange={setD2} required className={INPUT_CLASS} />
              </div>
              {/* digitável: filtra pelo trecho do nome; a lista sugere os fornecedores do período */}
              <div className="w-44">
                <CampoLista
                  value={fornecedor}
                  onChange={setFornecedor}
                  opcoes={fornecedores}
                  placeholder="Todos os fornecedores"
                  title="Fornecedor: digite parte do nome ou escolha na lista"
                  className={INPUT_CLASS}
                />
              </div>
              <select value={situacao} onChange={(e) => setSituacao(e.target.value)} title="Situação do cálculo do PV" className={`${INPUT_CLASS} !w-40 cursor-pointer whitespace-nowrap overflow-hidden`}>
                <option value="">Todas as situações</option>
                <option value="pend">Pendentes</option>
                <option value="N">Não calculadas</option>
                <option value="P">Parciais</option>
                <option value="C">Calculadas</option>
              </select>
              <Toggle size="sm" checked={verOcultos} onChange={setVerOcultos} label={<span className="text-[11px] text-stone-500 whitespace-nowrap">Ocultos</span>} title="Mostrar também as notas dos fornecedores marcados para não listar" />
            </div>
          }
          vazio={fornecedor || situacao ? 'Nenhuma compra no período com estes filtros.' : 'Nenhuma compra no período.'}
          colunas={[
            { key: 'dataEntrada', label: 'Entrada', alinhar: 'centro', largura: 100, render: (c) => formatDateBR(c.dataEntrada) },
            { key: 'dataEmissao', label: 'Emissão', alinhar: 'centro', largura: 100, render: (c) => formatDateBR(c.dataEmissao) },
            { key: 'numero', label: 'NF', alinhar: 'numero', largura: 90 },
            { key: 'serie', label: 'Série', alinhar: 'centro', largura: 60 },
            { key: 'cfop', label: 'CFOP', alinhar: 'centro', largura: 70 },
            {
              key: 'fornecedor',
              label: 'Fornecedor',
              largura: 360,
              render: (c) => (c.fornecedorOculto ? <span className="text-stone-400">{c.fornecedor} <span className="text-[10px] italic">(oculto)</span></span> : c.fornecedor),
            },
            { key: 'produtos', label: 'Produtos', alinhar: 'numero', largura: 90 },
            { key: 'total', label: 'Total da nota', alinhar: 'numero', largura: 130, render: (c) => formatDecimal(c.total, 2) },
            { key: 'situacao', label: 'Cálculo do PV', alinhar: 'centro', largura: 130, render: (c) => <Situacao valor={c.situacao} /> },
          ]}
          acoes={(c) => (
            <>
              <BotaoAcao icone={Calculator} titulo="Abrir compra" descricao="Ver os produtos da compra e calcular o preço de venda" onClick={() => abrirCompra(c)} />
              {c.fornecedorOculto ? (
                <BotaoAcao icone={Eye} titulo="Listar notas do fornecedor" rotulo="Listar" descricao="Voltar a mostrar as notas deste fornecedor na lista de compras" onClick={() => ocultarFornecedor(c, false)} />
              ) : (
                <BotaoAcao icone={EyeOff} titulo="Não listar notas do fornecedor" rotulo="Ocultar" descricao="Este fornecedor não precisa de cálculo de PV: as notas dele deixam de aparecer na lista" onClick={() => ocultarFornecedor(c, true)} />
              )}
            </>
          )}
        />
      </div>

      {compra && (
        <div className={aba === 'itens' ? 'flex-1 flex flex-col lg:flex-row min-h-0 min-w-0' : 'hidden'}>
          <ListaCrm
            className="flex-1 min-w-0"
            id="calcpv-itens"
            linhas={itens}
            carregando={carregandoItens}
            chave={(i) => i.id}
            selecionada={item?.id ?? null}
            onClique={(i: ItemCompraPv) => setItem(i)}
            barraExtra={
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setAba('compras')}
                  className="h-[34px] px-3 text-xs font-semibold rounded-md border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Compras
                </button>
                <span className="text-xs text-stone-500 dark:text-stone-400 truncate">
                  <strong className="text-stone-800 dark:text-stone-200">{notaTexto(compra)}</strong> — {compra.fornecedor}
                </span>
              </div>
            }
            vazio="Nenhum produto nesta compra."
            colunas={[
              { key: 'item', label: 'Item', alinhar: 'numero', largura: 60 },
              { key: 'idPro', label: 'Código', alinhar: 'numero', largura: 80 },
              { key: 'descricao', label: 'Descrição do produto', largura: 300 },
              { key: 'qtd', label: 'Qtd', alinhar: 'numero', largura: 80, render: (i) => formatQtd(i.qtd) },
              { key: 'un', label: 'Un', alinhar: 'centro', largura: 60, render: (i) => i.un || '–' },
              { key: 'custo', label: 'Custo unit.', alinhar: 'numero', largura: 110, render: (i) => formatDecimal(i.custo, 2) },
              { key: 'pvAtual', label: 'PV atual', alinhar: 'numero', largura: 100, render: (i) => formatDecimal(i.pvAtual, 2) },
              { key: 'calculado', label: 'Calculado', alinhar: 'centro', largura: 100, render: (i) => (i.calculado ? <span className="font-semibold text-emerald-700 dark:text-emerald-400">Sim</span> : <span className="text-stone-400">Não</span>) },
            ]}
            acoes={(i) => (
              <>
                <BotaoAcao icone={Calculator} titulo="Calcular PV" descricao="Calcular o preço de venda pelo custo desta compra e o markup" onClick={() => setItem(i)} />
                {i.calculado ? (
                  <BotaoAcao icone={Undo2} titulo="Desmarcar calculado" rotulo="Pendente" descricao="Volta o produto para pendente nesta compra (não altera o preço)" onClick={() => marcarCalculado(i, false)} />
                ) : (
                  <BotaoAcao icone={CheckCheck} titulo="Marcar como calculado" rotulo="Manter" tom="verde" descricao="Mantém o preço atual do cadastro e marca o produto como calculado nesta compra" onClick={() => marcarCalculado(i, true)} />
                )}
              </>
            )}
          />
          <PainelPv item={item} idCompra={compra.id} onErro={setErro} onGravado={gravado} onManter={(i) => marcarCalculado(i, true)} />
        </div>
      )}

      <div className={aba === 'produto' ? 'flex-1 flex flex-col lg:flex-row min-h-0 min-w-0' : 'hidden'}>
        <ListaCrm
          className="flex-1 min-w-0"
          id="calcpv-produtos"
          linhas={produtos}
          carregando={buscando}
          chave={(p) => p.id}
          selecionada={produto?.idPro ?? null}
          onClique={(p: ProdutoPv) => setProduto(comoItem(p))}
          barraExtra={
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setAba('compras')}
                className="h-[34px] px-3 text-xs font-semibold rounded-md border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Compras
              </button>
              {campoPesquisa}
              <div className="w-40">
                <CampoLista value={pMarca} onChange={setPMarca} opcoes={opcoes?.marcas ?? []} placeholder="Todas as marcas" title="Marca: digite o início ou escolha na lista" className={INPUT_CLASS} />
              </div>
              <div className="w-48">
                <CampoLista value={pClasse} onChange={setPClasse} opcoes={opcoes?.classes ?? []} placeholder="Todas as classes" title="Classe: digite parte do código ou da descrição, ou escolha na lista" className={INPUT_CLASS} />
              </div>
              {botaoPesquisa}
            </div>
          }
          vazio={pq || pMarca || pClasse ? 'Nenhum produto ativo com estes filtros.' : 'Informe o código, a descrição, a marca ou a classe e pesquise.'}
          colunas={[
            { key: 'id', label: 'Código', alinhar: 'numero', largura: 80 },
            { key: 'descricao', label: 'Descrição do produto', largura: 320 },
            { key: 'marca', label: 'Marca', largura: 140 },
            { key: 'classe', label: 'Classe', largura: 200 },
            { key: 'un', label: 'Un', alinhar: 'centro', largura: 60, render: (p) => p.un || '–' },
            { key: 'markup', label: '% Markup', alinhar: 'numero', largura: 100, render: (p) => formatDecimal(p.markup, 2) },
            { key: 'pvAtual', label: 'PV atual', alinhar: 'numero', largura: 100, render: (p) => formatDecimal(p.pvAtual, 2) },
          ]}
          acoes={(p) => <BotaoAcao icone={Calculator} titulo="Calcular PV" descricao="Calcular o preço de venda pelas últimas compras e o markup" onClick={() => setProduto(comoItem(p))} />}
        />
        <PainelPv
          item={produto}
          onErro={setErro}
          onGravado={(it, pv) => {
            setProdutos((lista) => lista.map((x) => (x.id === it.idPro ? { ...x, pvAtual: pv } : x)));
            setProduto((x) => (x ? { ...x, pvAtual: pv } : x));
            setSucesso(`Preço de venda de "${it.descricao}" gravado: ${formatCurrencyBRL(pv)}.`);
          }}
        />
      </div>

      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro('')} />}
      {sucesso && <AvisoErro mensagem={sucesso} tom="sucesso" onFechar={() => setSucesso('')} />}
    </div>
  );
};

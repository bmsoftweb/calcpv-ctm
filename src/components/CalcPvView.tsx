import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Calculator, Loader2, Save } from 'lucide-react';
import { fetchComprasPv, fetchItensCompraPv, fetchCustoPv, salvarPv, CompraPv, ItemCompraPv } from '../services/api';
import { formatCurrencyBRL, formatDateBR, formatDecimal, formatQtd, hojeISO } from '../utils/formatters';
import { useRefreshDaTela } from '@/components/LayoutApp';
import { ListaCrm } from '@/components/ListaCrm';
import { INPUT_CLASS, LABEL_CLASS } from '@/components/FormCrm';
import { BotaoAcao } from '@/components/MenuAcoes';
import { AvisoErro } from '@/components/AvisoErro';
import { NumberField } from './NumberField';
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
  idCompra: number;
  origem: string;
  onErro: (m: string) => void;
  onGravado: (item: ItemCompraPv, pv: number, situacao: string) => void;
}> = ({ item, idCompra, origem, onErro, onGravado }) => {
  const [carregando, setCarregando] = useState(false);
  const [v, setV] = useState({ custo: '', ipi: '', frete: '', st: '', markup: '' });
  const [salvando, setSalvando] = useState(false);
  /** PV acertado à mão (null = o calculado); ao acertar, o markup é recalculado a partir dele */
  const [pvAjustado, setPvAjustado] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setPvAjustado(null);
    let valido = true; // descarta a resposta de um produto que já foi trocado
    setCarregando(true);
    fetchCustoPv(item.idPro)
      .then((c) => {
        if (!valido) return;
        setV((s) => ({
          ...s,
          custo: item.custo.toFixed(2),
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
      const r = await salvarPv(item.idPro, n(v.markup), pvGravar, idCompra);
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
            <p className="-mt-2 text-[11px] text-stone-400">{origem}</p>
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
  const [aba, setAba] = useState<'compras' | 'itens'>('compras');
  const [d1, setD1] = useState(() => hojeISO(-30));
  const [d2, setD2] = useState(() => hojeISO());
  const [compras, setCompras] = useState<CompraPv[]>([]);
  const [fornecedor, setFornecedor] = useState('');
  /** '' todas, 'pend' não calculadas + parciais, 'N' não calculadas, 'P' parciais, 'C' calculadas */
  const [situacao, setSituacao] = useState('');
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

  const carregarItens = useCallback(async (c: CompraPv) => {
    try {
      setCarregandoItens(true);
      setItens(await fetchItensCompraPv(c.id));
    } catch (err: any) {
      setErro(err.message || 'Erro ao carregar os produtos da compra.');
    } finally {
      setCarregandoItens(false);
    }
  }, []);

  useEffect(() => void carregarCompras(), [carregarCompras]);

  // Fornecedores das compras do período, para o filtro
  const fornecedores = useMemo(() => [...new Set(compras.map((c) => c.fornecedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [compras]);
  const comprasFiltradas = compras.filter(
    (c) =>
      (!fornecedor || c.fornecedor === fornecedor) &&
      (!situacao || (situacao === 'pend' ? c.situacao !== 'C' : (c.situacao || 'N') === situacao)),
  );
  useRefreshDaTela(() => (aba === 'compras' ? carregarCompras() : compra && carregarItens(compra)));

  const abrirCompra = (c: CompraPv) => {
    setAba('itens');
    if (c.id === compra?.id) return;
    setCompra(c);
    setItem(null);
    setItens([]);
    carregarItens(c);
  };

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
              <span className="text-[11px] text-stone-400">Entrada de</span>
              <div className="w-36">
                <DateField value={d1} onChange={setD1} required className={INPUT_CLASS} />
              </div>
              <span className="text-[11px] text-stone-400">até</span>
              <div className="w-36">
                <DateField value={d2} onChange={setD2} required className={INPUT_CLASS} />
              </div>
              <select value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} title="Fornecedor" className={`${INPUT_CLASS} !w-52 cursor-pointer whitespace-nowrap overflow-hidden`}>
                <option value="">Todos os fornecedores</option>
                {fornecedor && !fornecedores.includes(fornecedor) && <option value={fornecedor}>{fornecedor}</option>}
                {fornecedores.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select value={situacao} onChange={(e) => setSituacao(e.target.value)} title="Situação do cálculo do PV" className={`${INPUT_CLASS} !w-36 cursor-pointer whitespace-nowrap overflow-hidden`}>
                <option value="">Todas as situações</option>
                <option value="pend">Pendentes</option>
                <option value="N">Não calculadas</option>
                <option value="P">Parciais</option>
                <option value="C">Calculadas</option>
              </select>
            </div>
          }
          vazio={fornecedor || situacao ? 'Nenhuma compra no período com estes filtros.' : 'Nenhuma compra no período.'}
          colunas={[
            { key: 'dataEntrada', label: 'Entrada', alinhar: 'centro', largura: 100, render: (c) => formatDateBR(c.dataEntrada) },
            { key: 'dataEmissao', label: 'Emissão', alinhar: 'centro', largura: 100, render: (c) => formatDateBR(c.dataEmissao) },
            { key: 'numero', label: 'NF', alinhar: 'numero', largura: 90 },
            { key: 'serie', label: 'Série', alinhar: 'centro', largura: 60 },
            { key: 'fornecedor', label: 'Fornecedor', largura: 360 },
            { key: 'total', label: 'Total da nota', alinhar: 'numero', largura: 130, render: (c) => formatDecimal(c.total, 2) },
            { key: 'situacao', label: 'Cálculo do PV', alinhar: 'centro', largura: 130, render: (c) => <Situacao valor={c.situacao} /> },
          ]}
          acoes={(c) => <BotaoAcao icone={Calculator} titulo="Abrir compra" descricao="Ver os produtos da compra e calcular o preço de venda" onClick={() => abrirCompra(c)} />}
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
            acoes={(i) => <BotaoAcao icone={Calculator} titulo="Calcular PV" descricao="Calcular o preço de venda pelo custo desta compra e o markup" onClick={() => setItem(i)} />}
          />
          <PainelPv item={item} idCompra={compra.id} origem={notaTexto(compra)} onErro={setErro} onGravado={gravado} />
        </div>
      )}

      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro('')} />}
      {sucesso && <AvisoErro mensagem={sucesso} tom="sucesso" onFechar={() => setSucesso('')} />}
    </div>
  );
};

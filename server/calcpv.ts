import { Router, Request, Response } from 'express';
import { consultar, consultarUm, executar, sqlInteiro, sqlNumero, sqlData, sqlTexto, hojeISO, agoraISO, BmapiError } from './bmapi.js';
import { config } from './config.js';

/**
 * Cálculo de preço de venda (CalcPV-CTM).
 *  - ENTRADASM (+ PESSOAS): últimas compras; ENTRADASPRODUTOS: itens da compra
 *  - PRODUTOSPRINCIPAL: produtos (descrição, markup e PV gravados)
 *  - ENTRADASPRODUTOS + ENTRADASM: custo do item da última nota de entrada do produto na empresa
 *  - PROCUSTOSEMP: % IPI, frete e ST de compra
 *
 * Situação do cálculo (campos sem uso no ERP para notas de compra):
 *  - ENTRADASPRODUTOS.OP_FLAG = 'C': item com PV gravado
 *  - ENTRADASM.TP_ASSINANTE: vazio = não calculada, 'P' = parcial, 'C' = todos os produtos calculados
 */

/** Recalcula ENTRADASM.TP_ASSINANTE pelos itens com produto da nota */
async function atualizarSituacaoCompra(idCompra: number): Promise<string> {
  const nf = sqlInteiro(idCompra);
  const [todos, feitos] = await Promise.all([
    consultarUm(`SELECT COUNT(*) n FROM ENTRADASPRODUTOS WHERE ID_NF = ${nf} AND ID_PRODUTO > 0`),
    consultarUm(`SELECT COUNT(*) n FROM ENTRADASPRODUTOS WHERE ID_NF = ${nf} AND ID_PRODUTO > 0 AND OP_FLAG = 'C'`),
  ]);
  const total = Number(todos?.n || 0);
  const calculados = Number(feitos?.n || 0);
  const situacao = calculados === 0 ? '' : calculados >= total ? 'C' : 'P';
  await executar(`UPDATE ENTRADASM SET TP_ASSINANTE = '${situacao}' WHERE ID = ${nf}`);
  return situacao;
}
export function createCalcPvRouter() {
  const router = Router();

  /** GET /api/calcpv/compras?d1=&d2= : notas de entrada da empresa no período (DATA_ENTRADA), a mais recente primeiro */
  router.get('/calcpv/compras', async (req: Request, res: Response) => {
    try {
      const d1 = sqlData(req.query.d1);
      const d2 = sqlData(req.query.d2);
      if (d1 === 'NULL' || d2 === 'NULL') throw new BmapiError('Informe o período.', 400);
      // ponytail: TOP 1000 por período; paginação no servidor se um período passar disso
      const rows = await consultar(
        `SELECT M.ID id, M.NUMERO numero, M.SERIE serie, M.CFOP cfop, M.DATA_EMISSAO data_emissao, M.DATA_ENTRADA data_entrada,
                M.TOTAL_NOTA total, M.TP_ASSINANTE situacao, F.ID id_fornec, F.NOME fornecedor, F.TIPO_CREDIARIO oculto
         FROM ENTRADASM M
         LEFT JOIN PESSOAS F ON F.ID = M.ID_FORNEC
         WHERE M.ID_EMPRESA = :emp
           AND (M.CANCELADO IS NULL OR M.CANCELADO <> 'S')
           AND (M.DEVOLUCAO IS NULL OR M.DEVOLUCAO <> 'S')
           AND M.DATA_ENTRADA >= ${d1} AND M.DATA_ENTRADA <= ${d2}
         ORDER BY data_entrada DESC, id DESC TOP 1000`,
        { emp: config.idEmpresa },
      );
      // quantidade de itens com produto (ENTRADASPRODUTOS.ID_PRODUTO > 0) por nota;
      // notas sem nenhum (serviço/despesa) ficam de fora
      const ids = rows.map((r) => sqlInteiro(r.id));
      const produtos = new Map(ids.length ? (await consultar(
        `SELECT ID_NF id, COUNT(*) n FROM ENTRADASPRODUTOS WHERE ID_NF IN (${ids.join(',')}) AND ID_PRODUTO > 0 GROUP BY ID_NF`,
      )).map((r) => [Number(r.id), Number(r.n || 0)]) : []);
      res.json(rows.filter((r) => produtos.get(Number(r.id))).map((r) => ({
        id: Number(r.id),
        numero: Number(r.numero || 0),
        serie: String(r.serie || '').trim(),
        cfop: String(r.cfop || '').trim(),
        dataEmissao: r.data_emissao ? String(r.data_emissao).slice(0, 10) : null,
        dataEntrada: r.data_entrada ? String(r.data_entrada).slice(0, 10) : null,
        total: Number(r.total || 0),
        produtos: produtos.get(Number(r.id)) || 0,
        idFornecedor: Number(r.id_fornec || 0),
        fornecedor: String(r.fornecedor || '').trim(),
        fornecedorOculto: String(r.oculto || '').trim() === 'S',
        situacao: String(r.situacao || '').trim(),
      })));
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/calcpv/fornecedores/:id : marca (ocultar=true) ou desmarca o fornecedor cujas notas não
   * precisam aparecer na lista de compras. Campo sem uso no ERP: PESSOAS.TIPO_CREDIARIO = 'S'.
   */
  router.put('/calcpv/fornecedores/:id', async (req: Request, res: Response) => {
    try {
      const n = await executar(
        `UPDATE PESSOAS SET TIPO_CREDIARIO = '${req.body?.ocultar ? 'S' : ''}' WHERE ID = ${sqlInteiro(req.params.id)}`,
      );
      if (!n) throw new BmapiError('Fornecedor não encontrado.', 404);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /** GET /api/calcpv/compras/:id/itens : produtos da nota de entrada */
  router.get('/calcpv/compras/:id/itens', async (req: Request, res: Response) => {
    try {
      const rows = await consultar(
        `SELECT P.ID id, P.ITEM item, P.ID_PRODUTO id_pro, C.DESCRICAO descricao, P.QTDADE qtd, P.UN_ITEM un,
                P.CUSTO_UNIT custo, P.CUSTO_TOTAL total, P.OP_FLAG flag, C.PRECOVENDA1 pv
         FROM ENTRADASPRODUTOS P
         LEFT JOIN PRODUTOSPRINCIPAL C ON C.ID = P.ID_PRODUTO
         WHERE P.ID_NF = :nf
         ORDER BY item, id`,
        { nf: Number(req.params.id) },
      );
      res.json(rows.map((r) => ({
        id: Number(r.id),
        item: Number(r.item || 0),
        idPro: Number(r.id_pro || 0),
        descricao: String(r.descricao || '').trim(),
        qtd: Number(r.qtd || 0),
        un: String(r.un || '').trim(),
        custo: Number(r.custo || 0),
        total: Number(r.total || 0),
        pvAtual: Number(r.pv || 0),
        calculado: String(r.flag || '').trim() === 'C',
      })));
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /**
   * GET /api/calcpv/custo/:idPro : custo unitário da última compra e % de IPI, frete e ST.
   * Custo: CUSTO_UNIT do item da última nota de entrada não cancelada nem de devolução
   * (maior DATA_ENTRADA, depois maior ID). Percentuais: PROCUSTOSEMP da empresa
   * (PIPI_COMPRA, PFRETE_COMPRA, STPORC_COMPRA).
   */
  router.get('/calcpv/custo/:idPro', async (req: Request, res: Response) => {
    try {
      const params = { emp: config.idEmpresa, pro: Number(req.params.idPro) };
      const [ultimas, pc, pp] = await Promise.all([
        consultar(
          `SELECT P.CUSTO_UNIT custo, M.NUMERO numero, M.DATA_ENTRADA data_entrada, P.ID id, F.NOME fornecedor
           FROM ENTRADASPRODUTOS P
           JOIN ENTRADASM M ON M.ID = P.ID_NF
           LEFT JOIN PESSOAS F ON F.ID = M.ID_FORNEC
           WHERE P.ID_PRODUTO = :pro AND M.ID_EMPRESA = :emp
             AND (M.CANCELADO IS NULL OR M.CANCELADO <> 'S')
             AND (M.DEVOLUCAO IS NULL OR M.DEVOLUCAO <> 'S')
           ORDER BY data_entrada DESC, id DESC TOP 20`,
          params,
        ),
        consultarUm(
          `SELECT ID id, PIPI_COMPRA ipi, PFRETE_COMPRA frete, STPORC_COMPRA st
           FROM PROCUSTOSEMP WHERE ID_EMPRESA = :emp AND ID_PRODUTO = :pro ORDER BY id TOP 1`,
          params,
        ),
        consultarUm(`SELECT LUCRO_VENDA_P1 markup, PRECOVENDA1 pv, DENSIDADE qtd_compras FROM PRODUTOSPRINCIPAL WHERE ID = :pro`, params),
      ]);
      const row = ultimas[0];
      res.json({
        custo: Number(row?.custo || 0),
        ipi: Number(pc?.ipi || 0),
        frete: Number(pc?.frete || 0),
        st: Number(pc?.st || 0),
        markupAtual: Number(pp?.markup || 0),
        // nº de últimas compras usado no cálculo, gravado no produto (DENSIDADE, sem uso no ERP); 0 = padrão 4
        qtdCompras: Number(pp?.qtd_compras || 0),
        pvAtual: Number(pp?.pv || 0),
        nota: row ? Number(row.numero || 0) : null,
        dataEntrada: row?.data_entrada ? String(row.data_entrada).slice(0, 10) : null,
        // últimas 20 compras do produto (a tela mostra quantas o usuário escolher, padrão 4) (a mais recente primeiro)
        ultimasCompras: ultimas.map((r) => ({
          dataEntrada: r.data_entrada ? String(r.data_entrada).slice(0, 10) : null,
          fornecedor: String(r.fornecedor || '').trim(),
          custo: Number(r.custo || 0),
        })),
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/calcpv/produtos/:id : grava o markup (LUCRO_VENDA_P1) e o PV calculado (PRECOVENDA1).
   * Com idCompra, marca os itens do produto na nota (OP_FLAG = 'C') e recalcula a situação da compra.
   */
  /**
   * PUT /api/calcpv/compras/:id/produtos/:idPro/calculado : marca (ou desmarca) o produto como calculado na nota
   * sem gravar preço — para quando o preço atual do cadastro fica como está. Recalcula a situação da compra.
   */
  router.put('/calcpv/compras/:id/produtos/:idPro/calculado', async (req: Request, res: Response) => {
    try {
      const idCompra = Number(req.params.id);
      await executar(
        `UPDATE ENTRADASPRODUTOS SET OP_FLAG = '${req.body?.calculado ? 'C' : ''}' WHERE ID_NF = ${sqlInteiro(idCompra)} AND ID_PRODUTO = ${sqlInteiro(req.params.idPro)}`,
      );
      res.json({ ok: true, situacao: await atualizarSituacaoCompra(idCompra) });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /**
   * GET /api/calcpv/produtos?q=&marca=&classe= : produtos ativos para calcular o PV sem abrir uma compra.
   * q = código (só dígitos) ou trecho da descrição; marca = início da marca; classe = "COD - DESCRIÇÃO" da lista
   * ou trecho do código/descrição da classe. Pelo menos um filtro.
   */
  router.get('/calcpv/produtos', async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q ?? '').trim().toUpperCase();
      const marca = String(req.query.marca ?? '').trim().toUpperCase();
      const classe = String(req.query.classe ?? '').trim().toUpperCase();
      if (!q && !marca && !classe) throw new BmapiError('Informe o código, a descrição, a marca ou a classe.', 400);
      const filtros = ["A.ATIVO = 'S'"];
      if (q) filtros.push(/^\d{1,9}$/.test(q) ? `A.ID = ${sqlInteiro(q)}` : `UPPER(A.DESCRICAO) LIKE ${sqlTexto(`%${q}%`)}`);
      if (marca) filtros.push(`UPPER(A.MARCA) LIKE ${sqlTexto(`${marca}%`)}`);
      if (classe) {
        const cod = classe.includes(' - ') ? classe.slice(0, classe.indexOf(' - ')).trim() : '';
        filtros.push(cod ? `UPPER(A.CLASSE) = ${sqlTexto(cod)}` : `(UPPER(A.CLASSE) LIKE ${sqlTexto(`${classe}%`)} OR UPPER(X.DESCRICAO) LIKE ${sqlTexto(`%${classe}%`)})`);
      }
      // ponytail: TOP 500; paginação no servidor se uma marca/classe passar disso
      const rows = await consultar(
        `SELECT A.ID id, A.DESCRICAO descricao, A.MARCA marca, A.CLASSE classe, X.DESCRICAO desc_classe,
                A.UNVENDA un, A.LUCRO_VENDA_P1 markup, A.PRECOVENDA1 pv
           FROM PRODUTOSPRINCIPAL A
           LEFT JOIN PRODUTOSCLASSE X ON X.CLASSE = A.CLASSE
          WHERE ${filtros.join(' AND ')}
          ORDER BY descricao TOP 500`,
      );
      res.json(rows.map((r) => ({
        id: Number(r.id),
        descricao: String(r.descricao || '').trim(),
        marca: String(r.marca || '').trim(),
        classe: [String(r.classe || '').trim(), String(r.desc_classe || '').trim()].filter(Boolean).join(' - '),
        un: String(r.un || '').trim(),
        markup: Number(r.markup || 0),
        pvAtual: Number(r.pv || 0),
      })));
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /** GET /api/calcpv/filtros-produtos : marcas dos produtos ativos e classes ("COD - DESCRIÇÃO"), para as listas */
  router.get('/calcpv/filtros-produtos', async (_req: Request, res: Response) => {
    try {
      const [marcas, classes] = await Promise.all([
        consultar(`SELECT DISTINCT MARCA marca FROM PRODUTOSPRINCIPAL WHERE ATIVO = 'S' AND MARCA <> '' ORDER BY marca`),
        consultar(`SELECT CLASSE classe, DESCRICAO descricao FROM PRODUTOSCLASSE ORDER BY classe`),
      ]);
      res.json({
        marcas: [...new Set(marcas.map((r) => String(r.marca || '').trim()).filter(Boolean))],
        classes: classes.map((r) => [String(r.classe || '').trim(), String(r.descricao || '').trim()].filter(Boolean).join(' - ')).filter(Boolean),
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /** PUT /api/calcpv/produtos/:id/compras : grava no produto quantas últimas compras entram no custo (DENSIDADE) */
  router.put('/calcpv/produtos/:id/compras', async (req: Request, res: Response) => {
    try {
      const qtd = Number(req.body?.qtd);
      if (!Number.isInteger(qtd) || qtd < 1 || qtd > 20) throw new BmapiError('Número de compras inválido (1 a 20).', 400);
      const n = await executar(`UPDATE PRODUTOSPRINCIPAL SET DENSIDADE = ${sqlInteiro(qtd)} WHERE ID = ${sqlInteiro(req.params.id)}`);
      if (!n) throw new BmapiError('Produto não encontrado.', 404);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  router.put('/calcpv/produtos/:id', async (req: Request, res: Response) => {
    try {
      const markup = Number(req.body?.markup);
      const pv = Math.round(Number(req.body?.pv) * 100) / 100;
      if (!Number.isFinite(markup)) throw new BmapiError('Markup inválido.', 400);
      if (markup < 0) throw new BmapiError('Preço de venda abaixo do custo total.', 400);
      if (!Number.isFinite(pv) || pv <= 0) throw new BmapiError('Preço de venda inválido.', 400);
      // custo total do cálculo (custo + IPI + frete + ST) vai para o custo de reposição
      const custo = Math.round(Number(req.body?.custo) * 100) / 100;
      if (!Number.isFinite(custo) || custo < 0) throw new BmapiError('Custo total inválido.', 400);
      const atual = await consultarUm(`SELECT PRECOVENDA1 pv FROM PRODUTOSPRINCIPAL WHERE ID = ${sqlInteiro(req.params.id)}`);
      if (!atual) throw new BmapiError('Produto não encontrado.', 404);
      const pvAnt = Math.round(Number(atual.pv || 0) * 100) / 100;
      const n = await executar(`
        UPDATE PRODUTOSPRINCIPAL SET LUCRO_VENDA_P1 = ${sqlNumero(markup)}, PRECOVENDA1 = ${sqlNumero(pv)},
               CUSTO_REPOSICAO = ${sqlNumero(custo)}, DATA_ALT = ${sqlData(hojeISO())}
        WHERE ID = ${sqlInteiro(req.params.id)}
      `);
      if (!n) throw new BmapiError('Produto não encontrado.', 404);
      // histórico de alteração de preço do ERP (lista 1), só quando o PV mudou
      if (pv !== pvAnt) {
        const agora = agoraISO();
        await executar(`
          INSERT INTO PROPRECOALTER (ID_PRODUTO, DATA, HORA, LISTA, PRECO_ANT, PRECO_NOVO, ID_USUARIO, INFO)
          VALUES (${sqlInteiro(req.params.id)}, ${sqlData(agora)}, ${sqlTexto(agora.slice(11, 19))}, '1',
                  ${sqlNumero(pvAnt)}, ${sqlNumero(pv)}, ${sqlInteiro(req.usuario?.idBm || 0)}, ${sqlTexto('CalcPV-CTM', 30)})
        `);
      }
      const idCompra = Number(req.body?.idCompra) || 0;
      if (!idCompra) return res.json({ ok: true });
      await executar(
        `UPDATE ENTRADASPRODUTOS SET OP_FLAG = 'C' WHERE ID_NF = ${sqlInteiro(idCompra)} AND ID_PRODUTO = ${sqlInteiro(req.params.id)}`,
      );
      res.json({ ok: true, situacao: await atualizarSituacaoCompra(idCompra) });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  return router;
}

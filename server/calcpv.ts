import { Router, Request, Response } from 'express';
import { consultar, consultarUm, executar, sqlInteiro, sqlNumero, sqlData, hojeISO, BmapiError } from './bmapi.js';
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
        `SELECT M.ID id, M.NUMERO numero, M.SERIE serie, M.DATA_EMISSAO data_emissao, M.DATA_ENTRADA data_entrada,
                M.TOTAL_NOTA total, M.TP_ASSINANTE situacao, F.NOME fornecedor
         FROM ENTRADASM M
         LEFT JOIN PESSOAS F ON F.ID = M.ID_FORNEC
         WHERE M.ID_EMPRESA = :emp
           AND (M.CANCELADO IS NULL OR M.CANCELADO <> 'S')
           AND (M.DEVOLUCAO IS NULL OR M.DEVOLUCAO <> 'S')
           AND M.DATA_ENTRADA >= ${d1} AND M.DATA_ENTRADA <= ${d2}
         ORDER BY data_entrada DESC, id DESC TOP 1000`,
        { emp: config.idEmpresa },
      );
      // só notas com produto (ENTRADASPRODUTOS.ID_PRODUTO > 0): notas de serviço/despesa ficam de fora
      const ids = rows.map((r) => sqlInteiro(r.id));
      const comProduto = new Set(ids.length ? (await consultar(
        `SELECT ID_NF id FROM ENTRADASPRODUTOS WHERE ID_NF IN (${ids.join(',')}) AND ID_PRODUTO > 0 GROUP BY ID_NF`,
      )).map((r) => Number(r.id)) : []);
      res.json(rows.filter((r) => comProduto.has(Number(r.id))).map((r) => ({
        id: Number(r.id),
        numero: Number(r.numero || 0),
        serie: String(r.serie || '').trim(),
        dataEmissao: r.data_emissao ? String(r.data_emissao).slice(0, 10) : null,
        dataEntrada: r.data_entrada ? String(r.data_entrada).slice(0, 10) : null,
        total: Number(r.total || 0),
        fornecedor: String(r.fornecedor || '').trim(),
        situacao: String(r.situacao || '').trim(),
      })));
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
      const [row, pc, pp] = await Promise.all([
        consultarUm(
          `SELECT P.CUSTO_UNIT custo, M.NUMERO numero, M.DATA_ENTRADA data_entrada, P.ID id
           FROM ENTRADASPRODUTOS P
           JOIN ENTRADASM M ON M.ID = P.ID_NF
           WHERE P.ID_PRODUTO = :pro AND M.ID_EMPRESA = :emp
             AND (M.CANCELADO IS NULL OR M.CANCELADO <> 'S')
             AND (M.DEVOLUCAO IS NULL OR M.DEVOLUCAO <> 'S')
           ORDER BY data_entrada DESC, id DESC TOP 1`,
          params,
        ),
        consultarUm(
          `SELECT ID id, PIPI_COMPRA ipi, PFRETE_COMPRA frete, STPORC_COMPRA st
           FROM PROCUSTOSEMP WHERE ID_EMPRESA = :emp AND ID_PRODUTO = :pro ORDER BY id TOP 1`,
          params,
        ),
        consultarUm(`SELECT LUCRO_VENDA_P1 markup, PRECOVENDA1 pv FROM PRODUTOSPRINCIPAL WHERE ID = :pro`, params),
      ]);
      res.json({
        custo: Number(row?.custo || 0),
        ipi: Number(pc?.ipi || 0),
        frete: Number(pc?.frete || 0),
        st: Number(pc?.st || 0),
        markupAtual: Number(pp?.markup || 0),
        pvAtual: Number(pp?.pv || 0),
        nota: row ? Number(row.numero || 0) : null,
        dataEntrada: row?.data_entrada ? String(row.data_entrada).slice(0, 10) : null,
      });
    } catch (err: any) {
      res.status(err?.status || 500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/calcpv/produtos/:id : grava o markup (LUCRO_VENDA_P1) e o PV calculado (PRECOVENDA1).
   * Com idCompra, marca os itens do produto na nota (OP_FLAG = 'C') e recalcula a situação da compra.
   */
  router.put('/calcpv/produtos/:id', async (req: Request, res: Response) => {
    try {
      const markup = Number(req.body?.markup);
      const pv = Math.round(Number(req.body?.pv) * 100) / 100;
      if (!Number.isFinite(markup)) throw new BmapiError('Markup inválido.', 400);
      if (markup < 0) throw new BmapiError('Preço de venda abaixo do custo total.', 400);
      if (!Number.isFinite(pv) || pv <= 0) throw new BmapiError('Preço de venda inválido.', 400);
      const n = await executar(`
        UPDATE PRODUTOSPRINCIPAL SET LUCRO_VENDA_P1 = ${sqlNumero(markup)}, PRECOVENDA1 = ${sqlNumero(pv)},
               DATA_ALT = ${sqlData(hojeISO())}
        WHERE ID = ${sqlInteiro(req.params.id)}
      `);
      if (!n) throw new BmapiError('Produto não encontrado.', 404);
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

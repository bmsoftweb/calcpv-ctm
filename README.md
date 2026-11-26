# CalcPV-CTM — Cálculo de Preço de Venda

Criado a partir do **producaoLite**, só com a tela **Calcular PV**, em duas abas sem orelha
(as duas ficam abertas, só a ativa aparece):

1. **Compras:** notas de entrada do período (`ENTRADASM.DATA_ENTRADA`, padrão últimos 30 dias; fornecedor em `PESSOAS`),
   a mais recente primeiro, só as que têm produto (`ENTRADASPRODUTOS.ID_PRODUTO > 0`). Dois cliques numa compra abrem os produtos dela.
2. **Produtos da compra** (`ENTRADASPRODUTOS`) com o painel de cálculo à direita: custo do
   item na nota (`CUSTO_UNIT`); % de IPI, frete e ST de `PROCUSTOSEMP` (`PIPI_COMPRA`,
   `PFRETE_COMPRA`, `STPORC_COMPRA`). O botão Gravar salva o markup em
   `PRODUTOSPRINCIPAL.LUCRO_VENDA_P1` e o PV em `PRECOVENDA1` (e `DATA_ALT`).

Situação do cálculo (campos sem uso no ERP em notas de compra comuns):
- `ENTRADASPRODUTOS.OP_FLAG = 'C'`: o PV do produto foi gravado a partir desta nota (marca
  todos os itens do mesmo produto na nota).
- `ENTRADASM.TP_ASSINANTE`: vazio = não calculada, `P` = parcial, `C` = todos os itens com
  produto calculados. Recalculado a cada gravação.

- Custo total = custo × (1 + %IPI + %frete + %ST)
- Preço de venda = custo total × (1 + %markup). Ex.: 100,00 com markup 80% = 180,00

Os dados vêm do ERP em DBISAM, pela **bmAPI**.

Mesmo layout e stack do **erp-compras**: Express + Vite (middleware) + React 19 +
React Router + Tailwind 4 + mysql2, fonte Jost, tema claro/escuro, casca com sidebar,
cabeçalho da tela e barra de status. O design system (`ListaCrm`, `FormCrm`, `MenuAcoes`,
`AvisoErro`, `Dica`) veio de lá; o destaque usa a paleta `marca` com as cores da CTM (azul `#0078B8`, marinho `#103068`), definida no `@theme` do `src/index.css`.

## Rodando

```bash
npm install
cp .env.example .env      # preencha MYSQL_USER / MYSQL_PASSWORD
npm run dev               # http://localhost:3005
```

O MySQL guarda apenas o cadastro de servidores da bmAPI (`bmapi.servidores`): o token
(X-API-Key) digitado no login encontra a linha do cliente, com a URL e a porta. Os dados do
ERP ficam no DBISAM do ERP, acessados só pelo servidor Node.

## Executável para os clientes

```bash
npm run build:exe
```

Gera `build/CalcPV-CTM.exe` (~57 MB, Windows x64), com o Node embutido. Para entregar,
copie para uma pasta:

```
CalcPV-CTM.exe
dist\            (gerada pelo build, vai junto)
.env             (senha do MySQL, SESSION_SECRET, CALCPV_PORT)
```

O cliente executa o .exe: ele sobe o servidor e abre o navegador em `localhost`. A janela
de console precisa ficar aberta enquanto o sistema estiver em uso. Rodando na máquina do
cliente, um servidor bmAPI cadastrado como `localhost` volta a funcionar — o que não
acontece na versão hospedada, em que quem chama a bmAPI é o servidor na nuvem.

## Tabelas

`ENTRADASM`, `PESSOAS`, `ENTRADASPRODUTOS` e `PROCUSTOSEMP` (leitura); `PRODUTOSPRINCIPAL` (leitura e gravação de `LUCRO_VENDA_P1`, `PRECOVENDA1`, `DATA_ALT`); gravação de `ENTRADASPRODUTOS.OP_FLAG` e `ENTRADASM.TP_ASSINANTE`.

## Histórico

### 1.0.1
- Lista de compras (notas de entrada) antes dos produtos, a mais recente primeiro, só as que têm produto;
  filtros de período, fornecedor e situação do cálculo; dois cliques abrem os produtos da compra.
- Painel de cálculo ao lado dos produtos: custo da compra, % IPI, frete e ST de `PROCUSTOSEMP`, markup.
- Preço de venda editável depois de calcular (o markup é recalculado a partir dele).
- Gravação do markup (`LUCRO_VENDA_P1`) e do PV (`PRECOVENDA1`); situação do cálculo na nota
  (`ENTRADASM.TP_ASSINANTE`) e no item (`ENTRADASPRODUTOS.OP_FLAG`).
- Paleta de cores, logo e ícones da CTM.
- Campo já focado também seleciona o conteúdo no primeiro clique.

### 1.0.0
- Primeira versão, a partir do producaoLite 1.0.3 (login, casca, listas e campos no padrão
  da casa), só com a tela **Calcular PV**.

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
  todos os itens do mesmo produto na nota). Também marcado sem gravar preço pelo botão "Manter preço atual"
  (ou pela ação "Marcar como calculado"); "Desmarcar calculado" volta o item para pendente.
- `ENTRADASM.TP_ASSINANTE`: vazio = não calculada, `P` = parcial, `C` = todos os itens com
  produto calculados. Recalculado a cada gravação.
- `PRODUTOSPRINCIPAL.DENSIDADE`: quantas últimas compras entram no custo do produto (spin no painel;
  vazio/0 = 4). O custo usado é o maior entre elas.
- `PESSOAS.TIPO_CREDIARIO = 'S'`: fornecedor cujas notas não precisam ser listadas (ação
  "Não listar notas do fornecedor" na lista de compras; o interruptor "Ocultos" mostra as notas dele de novo).

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

`ENTRADASM`, `PESSOAS`, `ENTRADASPRODUTOS`, `PROCUSTOSEMP` e `PRODUTOSCLASSE` (leitura); `PRODUTOSPRINCIPAL` (leitura e gravação de `LUCRO_VENDA_P1`, `PRECOVENDA1`, `DATA_ALT`, `DENSIDADE`); gravação de `ENTRADASPRODUTOS.OP_FLAG`, `ENTRADASM.TP_ASSINANTE` e `PESSOAS.TIPO_CREDIARIO`.

## Histórico

### 1.0.5
- Pesquisa de produtos sem passar pelas compras: código ou trecho da descrição, marca (`PRODUTOSPRINCIPAL.MARCA`)
  e classe (`CLASSE`, nome em `PRODUTOSCLASSE`), numa lista com o cálculo do PV ao lado. Grava o markup e o PV
  no produto sem marcar nota.

### 1.0.4
- Login: com "Lembrar usuário e token", o token do servidor também fica guardado no navegador
  e vem preenchido no próximo acesso (como no receitaWeb).

### 1.0.3
- Marcar o produto como calculado sem gravar preço ("Manter preço atual") e desmarcar.
- Ao abrir a nota, o cálculo já vem no 1º item com produto.
- Coluna CFOP da nota no grid de compras.
- Lista de fornecedores própria (`CampoLista`), no visual dos selects.

### 1.0.2
- Coluna com a quantidade de produtos da nota no grid de compras.
- Fornecedor marcado para não listar as notas (`PESSOAS.TIPO_CREDIARIO`), com o interruptor "Ocultos".
- Filtro de fornecedor digitável (trecho do nome), com o chevron cinza.
- Últimas compras do produto no painel (data, fornecedor, custo), com spin de 1 a 20 gravado por
  produto (`PRODUTOSPRINCIPAL.DENSIDADE`, padrão 4); o custo do cálculo é o maior entre elas.

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

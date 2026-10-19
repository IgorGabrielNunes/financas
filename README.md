# Caixa — controle de gastos para sair do cartão de crédito

Vue 3 + Vite (front) · Node 22 + Fastify + Postgres (API) · Deploy: Vercel + Render.

A métrica central é o **disponível real até o próximo salário**:

```
disponível = saldo das contas
           + receitas previstas até o horizonte (mês corrente em diante)
           − despesas previstas fora do crédito até o horizonte (inclui atrasadas)
           − faturas em aberto que vencem até o horizonte (inclui vencidas)
```

Horizonte = data da próxima receita prevista (normalmente o salário); sem receita prevista, fim do mês.
"Pode passar no cartão" = `min(limite livre, disponível)` — limite não é dinheiro.

## Rodando local

```bash
# Postgres local (ou docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16)
cd backend
cp .env.example .env           # ajuste DATABASE_URL e JWT_SECRET (>= 32 chars)
npm i
npm run user:create -- voce@email.com "Igor" "uma-senha-forte"   # migra + cria usuário e categorias
npm run dev                    # http://localhost:3333

cd ../frontend
cp .env.example .env           # VITE_API_URL=http://localhost:3333
npm i && npm run dev           # http://localhost:5173
```

Testes: `npm test` (regras de fatura, puro) e `npm run test:e2e` (fluxo completo contra o Postgres do `.env`;
cria um usuário descartável e apaga no final).

## Deploy em produção (custo zero)

Arquitetura: **Vercel** (front) → **Render** (API) → **Neon** (Postgres) + **Cloudflare R2** (comprovantes).

Por que não o Postgres free do Render: ele expira 30 dias após a criação (14 dias de carência e depois é apagado).
O free do Neon é permanente, 1 GB por projeto, sem cartão de crédito. O disco do Render é efêmero, por isso comprovantes vão
para o R2 (10 GB grátis, sem custo de saída).

### 1. Banco (Neon)
1. Crie o projeto em neon.com (região mais próxima disponível, ex.: São Paulo se houver).
2. Copie a *connection string* (formato `postgresql://usuario:senha@ep-xxx.neon.tech/neondb?sslmode=require`).
   Se a conexão falhar por `channel_binding`, remova `&channel_binding=require` do final.

### 2. Comprovantes (Cloudflare R2)
1. R2 → Create bucket → nome `caixa-comprovantes`. Deixe **privado** (não ative acesso público nem r2.dev).
2. R2 → Manage API tokens → Create token com permissão **Object Read & Write** restrita a esse bucket.
3. Guarde: *Access Key ID*, *Secret Access Key* e o endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
   Não precisa configurar CORS: o upload passa pela API e a visualização abre o link assinado (5 min) em nova aba.

### 3. Repositório
Suba esta pasta para um repositório **privado** no GitHub (`.env` já está no `.gitignore`).

### 4. API (Render)
1. New → **Blueprint** → selecione o repositório (usa o `render.yaml`).
2. Preencha: `DATABASE_URL` (Neon), `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
   `CORS_ORIGIN` pode ficar `http://localhost:5173` por enquanto. `JWT_SECRET` é gerado pelo Render.
3. Deploy. As migrations rodam no boot. Teste `https://caixa-api.onrender.com/health` → `{"ok":true}`.

### 5. Criar seu usuário (da sua máquina)
O plano free do Render não tem Shell, então o usuário é criado localmente apontando para o banco de produção:

```bash
cd backend
DATABASE_URL="<connection string do Neon>" DATABASE_SSL=true JWT_SECRET="qualquer-coisa-com-32-caracteres-ou-mais" \
  npm run user:create -- seu@email.com "Igor" "uma-senha-forte-de-verdade"
```

### 6. Front (Vercel)
1. New Project → mesmo repositório → **Root Directory: `frontend`** (framework Vite é detectado).
2. Variável `VITE_API_URL=https://caixa-api.onrender.com` (sem barra no fim). Ela entra no build: mudou, faça redeploy.
3. Deploy. O `vercel.json` faz o rewrite das rotas do SPA (F5 em `/cartoes` não dá 404).

### 7. Fechar o CORS
No Render, troque `CORS_ORIGIN` para o domínio da Vercel, exatamente como aparece no navegador
(`https://caixa-xxx.vercel.app`, sem barra). Para aceitar mais de um, separe por vírgula. Salve (redeploy automático).

### Checklist de validação
- [ ] Login funciona no celular e no computador.
- [ ] Lançar um gasto com **foto e PDF**; reabrir e abrir o comprovante (abre em nova aba).
- [ ] Bucket R2 mostra os arquivos em `<user_id>/<lancamento_id>/`.
- [ ] Excluir o lançamento remove os arquivos do bucket.
- [ ] Redeploy da API não apaga nada (dados no Neon, arquivos no R2).

### O que esperar do plano grátis
- **Primeiro acesso lento:** a API dorme após 15 min sem uso e leva ~1 min para acordar. O Neon também suspende após
  5 min, mas acorda em segundos.
- **Não use ping para manter acordado:** as 750 horas grátis do Render são **por workspace**, compartilhadas com o Pulse.
  Duas APIs sempre acordadas estouram o limite e o Render suspende **todos** os serviços grátis até o mês seguinte.
  Se o tempo de acordar incomodar, o plano Starter do Render resolve só para esta API.
- **Backup:** faça `pg_dump "<connection string>" > caixa-AAAA-MM-DD.sql` periodicamente (cliente `pg_dump` 16+).

## Regras de domínio (backend/src/domain/fatura.ts — testadas)

| Regra | Decisão |
|---|---|
| Ciclo da compra | Compra **no dia do fechamento ou depois** vai para a fatura seguinte. Único ponto a mudar se seu banco divergir. |
| Vencimento | `dia_venc > dia_fech` → vence no mesmo mês do fechamento; senão no mês seguinte. |
| Mês curto | Dia 31 em fevereiro vira 28/29 (fechamento e vencimento). |
| Parcelas | Centavos inteiros; a diferença de arredondamento vai na 1ª parcela. Soma sempre bate. |
| Limite usado | Tudo que está em aberto em faturas atuais **e futuras** (uma compra 10x consome o limite inteiro). |
| Fatura | Total **derivado** das parcelas; a tabela só guarda datas e pagamento. |
| Compra antiga em andamento | `parcelas_pagas_antes`: as N primeiras parcelas não geram fatura nem consomem limite. |
| Fatura paga | Bloqueia criar/alterar/excluir parcelas nela (409). Desfaça o pagamento antes. |
| Pagamento sem conta | "Pago fora do Caixa": registra o pagamento sem mexer em saldo (útil no onboarding). |
| Recorrências | Regra ≠ instância. Instâncias geradas sob demanda por mês, idempotentes (índice único + savepoint). Editar a regra regenera as **previstas** do mês atual em diante; realizadas nunca mudam. |
| Mudar dia de fechamento | Vale para compras novas; faturas existentes mantêm as datas. |

## Pessoas, dívidas e inadimplência

| Regra | Decisão |
|---|---|
| Perfil | Cada pessoa tem cargo e **salário líquido**. Contas e cartões têm **titular**; daí saem maior limite, soma dos limites e quantidade de cartões de crédito/débito. |
| Salário → fixo | Vira uma recorrência **vinculada** (`origem = 'salario'`). Edita-se no perfil; a tela de fixos recusa editar (409). Se o dia do salário deste mês já passou, a previsão começa no mês seguinte (o valor já está no saldo). |
| Dívida parcelada | Parcelas pagas/restantes **derivadas das datas** (supõe pagamento em dia). Débito/boleto/pix geram as parcelas restantes como fixo com data de fim. **Desconto em folha não gera saída de caixa** (o salário cadastrado já é o líquido). |
| Quitação estimada | Valor presente das restantes pela taxa mensal informada (Price). É estimativa: peça o valor oficial ao banco. |
| Inadimplência | Credor, origem, **motivo**, valor original e atual, desde quando, negativado. Em acordo, as parcelas viram fixo vinculado (`origem = 'acordo'`). |
| Negativação | Mostra a data-limite de 5 anos a partir do vencimento informado. Sair do cadastro não extingue a dívida. |
| Receita prevista vencida | Não entra no disponível (pode ter caído sem confirmação ou ter atrasado); aparece como pendência para confirmar. |
| Fixos retroativos | Uma regra nunca gera "previsto" em mês anterior ao seu cadastro, evitando contas fantasmas atrasadas. |

## Salário, 13º, férias e rescisão (CLT)

Motor em `backend/src/domain/clt.ts`, funções puras e testadas. As tabelas ficam em `TABELAS` por ano; para um ano
sem tabela, usa a mais recente e a tela avisa. **Todo janeiro, atualize as faixas de INSS e IR.**

| Tema | Regra implementada |
|---|---|
| Histórico | Salário **bruto** por data de vigência (aumento, dissídio, promoção). O líquido é bruto − INSS − IR − descontos fixos − consignado em folha, ou o valor exato do holerite, se informado. |
| Mês do pagamento | `paga_mes_seguinte`: o salário que cai em novembro é o de outubro; um aumento vigente em novembro aparece em dezembro. A previsão de cada mês usa o histórico. |
| INSS 2026 | Progressivo de 7,5% a 14%, teto R$ 8.475,55. |
| IRRF 2026 | Tabela progressiva com a dedução mais vantajosa (INSS + dependentes ou simplificado de R$ 607,20), mais o redutor da Lei 15.270/2025: zera até R$ 5.000 e reduz até R$ 7.350. Vale também para o 13º. |
| 13º | Avos com 15+ dias no mês. 1ª parcela (30/11) sem desconto; 2ª (20/12) com INSS e IR exclusivo. Vira fixo previsto em nov/dez. |
| Férias | Períodos aquisitivos desde a admissão; férias registradas abatem o mais antigo (FIFO). Prazo de gozo e alerta de pagamento em dobro (art. 137). Venda de até 10 dias (abono + 1/3) sem INSS e IR. Faltas não são consideradas. |
| Rescisão sem justa causa | Aviso indenizado proporcional (30 + 3 por ano, até 90), com projeção para 13º e férias. FGTS 8% sobre as verbas e multa de 40%. Com saque-aniversário, só a multa é liberada. |
| Pedido de demissão | Aviso de 30 dias trabalhado (saída 30 dias depois do aviso); 13º e férias proporcionais; sem saque, sem multa. |
| Justa causa | Só saldo de salário e férias vencidas + 1/3. |
| Isenções | Aviso indenizado, férias indenizadas + 1/3 e multa do FGTS sem IR; férias indenizadas sem INSS. |
| FGTS estimado | 8% do salário de cada mês + 8% do 13º, a partir do saldo informado. Ignora a remuneração da conta, então o saldo real tende a ser maior. |

Fora do escopo: horas extras, adicionais, médias de variáveis, faltas, PLR, seguro-desemprego (só sinalizado).

## Decisões técnicas

- **Dinheiro em centavos (`bigint`)**, parse para `number` no driver (seguro até 2^53).
- **DATE como string `YYYY-MM-DD`** em todo o caminho (parser do `pg` + formatação por string no front): elimina o
  bug clássico de "voltar um dia" entre servidor UTC e cliente -03:00. "Hoje" é calculado em `America/Sao_Paulo`.
- **Multiusuário desde o schema** (`user_id` em tudo, filtro em todas as queries). Teste e2e cobre o isolamento.
- **Comprovantes**: tipo validado por magic bytes (não confia no Content-Type), 10 MB, compressão no navegador
  (lado maior 1600 px, JPEG 0.82), chave no banco, arquivo no storage, remoção do arquivo só após commit.
- **Auth**: scrypt nativo (sem binário nativo para quebrar build), JWT 30 dias, rate limit no login, sem cadastro público.
- **Migrations SQL puras** com `pg_advisory_lock`, aplicadas no boot.

## Próximos passos sugeridos

1. Metas por categoria (teto mensal) com alerta na tela de lançamento.
2. Importação de OFX/CSV do banco e conciliação com os lançamentos.
3. Plano de saída do cartão: meta de % no crédito por mês e gráfico de evolução da dívida.
4. PWA (instalar na tela inicial + lançamento offline com fila).
5. Refresh token / sessão revogável (hoje o JWT vale 30 dias e não é revogável).

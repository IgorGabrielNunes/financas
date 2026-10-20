# Vida — finanças, tarefas, estudos, saúde, projetos e carreira

Vue 3 + Vite (front) · Node 22 + Fastify + Postgres (API) · Deploy: Vercel + Render + Neon + R2.

Monólito modular: **um backend, um banco, um front**. Cada módulo é uma pasta (`backend/src/modulos/<mod>`,
`frontend/src/modulos/<mod>`) registrada numa lista (`modulos/index.ts` dos dois lados). Módulos conversam por
chamada de função/consulta no mesmo processo — sem fila e sem segundo backend (custo zero, transação única).

| Módulo | O que tem | Dono dos dados |
|---|---|---|
| Finanças | contas, cartões, faturas, fixos, lançamentos, comprovantes, pessoas/salários, CLT, dívidas | **casa** (compartilhado) |
| Tarefas | áreas, hoje/semana/algum dia, repetição diária/semanal/mensal, sequência, histórico | usuário; "tarefa da casa" é vista por todos |
| Anotações | notas com etiquetas, fixar, cores, busca | usuário |
| Estudos | cursos, disciplinas, avaliações (média ponderada e quanto falta), livros, horas | usuário |
| Saúde | academia (fichas, treino do dia, cargas e evolução), dieta (planos por tipo de dia, refeições, macros), consultas/exames, remédios e doses, peso/IMC | usuário |
| Projetos | pessoal/software/produto/profissional, kanban com arrastar, marcos, pontos, bugs, branch/PR, links, modelo de cobrança | usuário |
| Profissional | experiências, habilidades, metas, funil de vagas, entrevistas, currículo para imprimir/PDF | usuário |

## Casa e usuários

- Cada login pertence a uma **casa**. O primeiro usuário (`npm run user:create`) é **admin** e já ganha o perfil
  em Pessoas com o primeiro nome.
- Admin adiciona pessoas em **Usuários da casa** (menu lateral ou Mais): nome, e-mail, papel e senha temporária.
  O usuário é obrigado a trocar a senha no primeiro acesso. Ao criar, ele é ligado a um perfil de Pessoas
  (existente ou criado com o primeiro nome) — **é assim que cada um lança o próprio salário**.
- Não existe cadastro público (decisão: dados sensíveis). Desativar um usuário corta o acesso em até 60 s
  (checagem no banco com cache curto), sem esperar o token expirar.
- Após a migração 005, **sessões antigas pedem login de novo** (o token passou a carregar a casa).

## Migrations

Rodam sozinhas no boot da API (Render). 012 cria academia e dieta; 013 os avisos. 005 converte os dados financeiros de `user_id` para `casa_id` preservando
tudo (a casa recebe o mesmo id do usuário antigo); 006–011 criam os módulos novos.

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

## Avisos (WhatsApp e Telegram) — custo zero

```
Cloudflare Worker (cron a cada 5 min) ──► Neon (lê o dia de cada um) ──► WhatsApp (CallMeBot) / Telegram
API no Render ──► configuração, prévia, "enviar teste" e webhook do robô do Telegram
```

- **Pessoais**: cada usuário escolhe o canal e o que quer receber em **Avisos** (menu lateral → Avisos no WhatsApp):
  resumo do dia, hora do treino, remédios, consultas, entrevistas e refeições, com "não perturbe" e modo discreto.
- **Grupo da casa** (Telegram): resumo diário das tarefas compartilhadas e das contas/faturas vencendo.
  Cada pessoa também pode escolher o canal **Grupo** para os avisos pessoais: chegam no mesmo grupo com o nome no topo
  ("👤 Igor — hora do treino"). Como todos leem, o modo discreto é recomendado para remédios e consultas.
  WhatsApp grátis não envia para grupos (limite do CallMeBot), por isso o grupo é no Telegram.
- A regra fica em `backend/src/modulos/avisos` (função pura + coleta + disparo com deduplicação), testada com Postgres real;
  o Worker (`workers/avisos`) só liga o cron ao driver do Neon. **Não acorda a API no Render**: as horas grátis de lá
  ficam para quando você usa o app.
- Deduplicação por chave (`notif_enviadas`): cron duplicado/atrasado não repete mensagem; falha de envio volta no ciclo seguinte.

### 1. WhatsApp (cada pessoa, 1 minuto)
1. Salve **+34 621 331 709** nos contatos e mande `I allow callmebot to send me messages`.
2. Cole o número e a apikey recebida em **Avisos**, toque em **Salvar e testar** e depois **Ligar avisos**.

### 2. Robô do Telegram (opcional — para o grupo da casa ou quem preferir Telegram)
1. No Telegram, fale com **@BotFather** → `/newbot` → escolha nome e usuário (ex.: `VidaCasaIgorBot`). Guarde o token.
2. No Render (financas-api → Environment), adicione:
   `TELEGRAM_BOT_TOKEN` (o token), `TELEGRAM_BOT_USERNAME` (sem @) e `TELEGRAM_WEBHOOK_SECRET` (uma senha aleatória com 16+ caracteres).
3. Depois do deploy, registre o webhook uma vez. Mais simples: abra no navegador (troque os 3 valores):
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL_DA_API>/telegram/webhook&secret_token=<SEGREDO>&allowed_updates=["message"]`
   — deve responder `"Webhook was set"`. Alternativa: na sua máquina, com `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
   e `PUBLIC_API_URL` (de produção) no `backend/.env`, rode `npm run telegram:webhook`.
4. Em **Avisos**: "Gerar link de vínculo" (pessoal) e, como admin, "Gerar código do grupo" (adicione o robô ao grupo pelo link).

### 3. Worker na Cloudflare (dispara os avisos)
1. Crie uma conta grátis em cloudflare.com (não precisa de cartão para Workers).
2. **My Profile → API Tokens → Create Token → modelo "Edit Cloudflare Workers"**. Copie o token e o **Account ID**
   (aparece na página inicial de Workers & Pages).
3. No GitHub: **Settings → Secrets and variables → Actions** → crie `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
4. **Actions → Worker de avisos → Run workflow**. Ele roda os testes da regra e publica o `vida-avisos`.
5. Na Cloudflare: **Workers & Pages → vida-avisos → Settings → Variables and Secrets**, adicione como *Secret*:
   `DATABASE_URL` (a mesma connection string do Neon da API) e, se usar Telegram, `TELEGRAM_BOT_TOKEN`.
6. Acompanhe em **vida-avisos → Logs**: a cada 5 minutos aparece `{"enviados":N,"erros":[...]}`.

Limites do plano grátis que importam: Workers 100 mil requisições/dia e 5 crons por conta (usamos 1);
o Worker abre **uma** conexão WebSocket com o Neon por execução (o modo HTTP faria uma chamada externa por consulta e
estouraria o limite de 50 por execução). Alternativa sem Cloudflare: qualquer cron externo chamando
`POST /interno/avisos/disparar` com `Authorization: Bearer $AVISOS_TOKEN` (mas aí acorda a API no Render).

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
- **Isolamento por dono**: finanças filtram por `casa_id`, módulos pessoais por `user_id`; FKs de outro dono são
  recusadas no CRUD genérico (`core/crud.ts`). Testes e2e cobrem isolamento entre casas e entre membros.
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

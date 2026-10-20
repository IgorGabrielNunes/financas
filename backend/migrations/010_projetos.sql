-- Projetos: gerais, com quadro (kanban). Software e produto ganham campos e colunas extras.
create table projetos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references usuarios(id) on delete cascade,
  nome             text not null,
  descricao        text,
  tipo             text not null default 'pessoal' check (tipo in ('pessoal','software','produto','profissional')),
  status           text not null default 'ideia' check (status in ('ideia','planejamento','andamento','pausado','concluido','lancado','arquivado')),
  cor              text not null default '#0f4b3a',
  inicio           date,
  prazo            date,
  -- software / produto
  repo_url         text,
  producao_url     text,
  homologacao_url  text,
  stack            text[] not null default '{}',
  versao_atual     text,
  -- produto
  publico_alvo     text,
  proposta_valor   text,
  modelo_cobranca  text check (modelo_cobranca in ('gratuito','unico','mensal','anual','freemium','sob_consulta')),
  preco_centavos   bigint check (preco_centavos is null or preco_centavos >= 0),
  created_at       timestamptz not null default now()
);

create table projeto_marcos (                -- versões / releases / entregas
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references usuarios(id) on delete cascade,
  projeto_id   uuid not null references projetos(id) on delete cascade,
  nome         text not null,                 -- "v1.0 MVP", "Lançamento beta"
  descricao    text,
  data_alvo    date,
  concluido_em date,
  created_at   timestamptz not null default now()
);

create table projeto_cards (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references usuarios(id) on delete cascade,
  projeto_id        uuid not null references projetos(id) on delete cascade,
  marco_id          uuid references projeto_marcos(id) on delete set null,
  titulo            text not null,
  descricao         text,
  status            text not null default 'a_fazer' check (status in ('backlog','a_fazer','fazendo','revisao','feito')),
  ordem             double precision not null default 0,   -- fracionário: mover card não renumera a coluna
  tipo              text not null default 'tarefa' check (tipo in ('tarefa','funcionalidade','bug','melhoria','debito_tecnico','pesquisa','documentacao')),
  prioridade        smallint not null default 2 check (prioridade between 1 and 3),
  estimativa_pontos smallint check (estimativa_pontos in (1,2,3,5,8,13,21)),
  prazo             date,
  branch            text,
  pr_url            text,
  concluido_em      timestamptz,
  created_at        timestamptz not null default now()
);
create index on projeto_cards (projeto_id, status, ordem);

-- =====================================================================
-- Tarefas. Avulsa: concluída uma vez (concluida_em). Repetida: cada ocorrência
-- é concluída em tarefa_conclusoes; as ocorrências são CALCULADAS (domínio), nunca
-- materializadas — "todo dia" não vira 365 linhas e dia perdido não vira pilha.
-- Privada do usuário, ou compartilhada com a casa (limpeza, compras...).
-- =====================================================================
create table tarefa_areas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references usuarios(id) on delete cascade,
  nome       text not null,
  cor        text not null default '#64748b',
  ordem      smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, nome)
);

create table tarefas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references usuarios(id) on delete cascade,  -- quem criou
  casa_id       uuid not null references casas(id) on delete cascade,
  compartilhada boolean not null default false,                           -- visível para a casa toda
  area_id       uuid references tarefa_areas(id) on delete set null,
  responsavel_id uuid references usuarios(id) on delete set null,
  titulo        text not null,
  notas         text,
  prioridade    smallint not null default 2 check (prioridade between 1 and 3),  -- 1 alta, 2 normal, 3 baixa
  data          date,                 -- avulsa: quando (null = algum dia). Repetida: início da série.
  repeticao     text not null default 'nenhuma' check (repeticao in ('nenhuma','diaria','semanal','mensal')),
  dias_semana   smallint[] check (dias_semana is null or dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]),
  fim           date,
  concluida_em  timestamptz,
  concluida_por uuid references usuarios(id) on delete set null,
  arquivada     boolean not null default false,
  created_at    timestamptz not null default now(),
  check (repeticao = 'nenhuma' or data is not null),
  check (repeticao <> 'semanal' or coalesce(array_length(dias_semana, 1), 0) > 0),
  check (repeticao = 'nenhuma' or concluida_em is null)
);
create index on tarefas (user_id) where not arquivada;
create index on tarefas (casa_id) where compartilhada and not arquivada;

create table tarefa_conclusoes (
  id        uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references tarefas(id) on delete cascade,
  data      date not null,
  feita_por uuid references usuarios(id) on delete set null,
  feita_em  timestamptz not null default now(),
  unique (tarefa_id, data)
);

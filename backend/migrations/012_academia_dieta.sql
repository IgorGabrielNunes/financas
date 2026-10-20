-- Academia e dieta (privado do usuário).
-- Fichas de treino com exercícios; o "treino de hoje" sai dos dias fixos da ficha ou do rodízio
-- (fichas sem dias fixos se alternam na ordem: A → B → C → A...).
create table academia_fichas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references usuarios(id) on delete cascade,
  nome         text not null,                    -- "Treino A"
  foco         text,                             -- "Peito e tríceps"
  dias_semana  smallint[] not null default '{}' check (dias_semana <@ array[0,1,2,3,4,5,6]::smallint[]),
  horario      text check (horario is null or horario ~ '^[0-2][0-9]:[0-5][0-9]$'),  -- hora do aviso
  ordem        smallint not null default 0,
  ativa        boolean not null default true,
  cor          text not null default '#13805a',
  observacoes  text,
  created_at   timestamptz not null default now()
);
create index on academia_fichas (user_id, ativa);

create table academia_exercicios (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references usuarios(id) on delete cascade,
  ficha_id      uuid not null references academia_fichas(id) on delete cascade,
  ordem         smallint not null default 0,
  nome          text not null,                   -- "Supino reto com barra"
  grupo         text not null default 'outro' check (grupo in ('peito','costas','pernas','gluteos','ombros','biceps','triceps','abdomen','cardio','mobilidade','outro')),
  series        smallint check (series is null or series between 1 and 20),
  repeticoes    text,                            -- "8-12", "15", "até a falha", "30s"
  carga_kg      numeric(6,2) check (carga_kg is null or carga_kg >= 0),
  descanso_seg  smallint check (descanso_seg is null or descanso_seg between 0 and 900),
  video_url     text,
  observacoes   text,
  created_at    timestamptz not null default now()
);
create index on academia_exercicios (ficha_id, ordem);

-- Execução: o treino feito continua em saude_treinos (aparece no histórico e no resumo semanal);
-- aqui ficam a ficha usada e as cargas de cada exercício naquele dia (evolução de carga).
alter table saude_treinos add column ficha_id uuid references academia_fichas(id) on delete set null;
create index on saude_treinos (user_id, ficha_id, data);

create table academia_registros (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references usuarios(id) on delete cascade,
  treino_id     uuid not null references saude_treinos(id) on delete cascade,
  exercicio_id  uuid references academia_exercicios(id) on delete set null,
  exercicio     text not null,                   -- nome no dia (histórico sobrevive à edição da ficha)
  series_feitas smallint check (series_feitas is null or series_feitas between 0 and 50),
  repeticoes    text,
  carga_kg      numeric(6,2) check (carga_kg is null or carga_kg >= 0),
  concluido     boolean not null default true
);
create index on academia_registros (exercicio_id);
create index on academia_registros (treino_id);

-- Dieta: planos com refeições e alimentos. Um plano vale para todos os dias, só dias de treino
-- ou só dias de descanso (comum em planos de nutricionista).
create table dieta_planos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references usuarios(id) on delete cascade,
  nome        text not null,
  aplica_em   text not null default 'todos' check (aplica_em in ('todos','treino','descanso')),
  ativo       boolean not null default true,
  kcal_meta   integer check (kcal_meta is null or kcal_meta between 500 and 10000),
  proteina_g  integer check (proteina_g is null or proteina_g between 0 and 1000),
  carbo_g     integer check (carbo_g is null or carbo_g between 0 and 2000),
  gordura_g   integer check (gordura_g is null or gordura_g between 0 and 1000),
  agua_ml     integer check (agua_ml is null or agua_ml between 0 and 10000),
  profissional text,                              -- quem passou o plano
  observacoes text,
  created_at  timestamptz not null default now()
);

create table dieta_refeicoes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references usuarios(id) on delete cascade,
  plano_id   uuid not null references dieta_planos(id) on delete cascade,
  nome       text not null,                       -- "Café da manhã"
  horario    text check (horario is null or horario ~ '^[0-2][0-9]:[0-5][0-9]$'),
  ordem      smallint not null default 0,
  lembrar    boolean not null default false,      -- aviso no WhatsApp na hora
  observacoes text,
  created_at timestamptz not null default now()
);
create index on dieta_refeicoes (plano_id, ordem);

create table dieta_itens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references usuarios(id) on delete cascade,
  refeicao_id uuid not null references dieta_refeicoes(id) on delete cascade,
  ordem       smallint not null default 0,
  alimento    text not null,                      -- "Ovo mexido"
  quantidade  text,                               -- "2 unidades", "100 g"
  kcal        integer check (kcal is null or kcal between 0 and 5000),
  proteina_g  numeric(6,1) check (proteina_g is null or proteina_g >= 0),
  carbo_g     numeric(6,1) check (carbo_g is null or carbo_g >= 0),
  gordura_g   numeric(6,1) check (gordura_g is null or gordura_g >= 0),
  substituicoes text                              -- "ou 1 iogurte natural"
);
create index on dieta_itens (refeicao_id, ordem);

create table dieta_registros (
  user_id     uuid not null references usuarios(id) on delete cascade,
  refeicao_id uuid not null references dieta_refeicoes(id) on delete cascade,
  data        date not null,
  feita_em    timestamptz not null default now(),
  primary key (refeicao_id, data)
);
create index on dieta_registros (user_id, data);

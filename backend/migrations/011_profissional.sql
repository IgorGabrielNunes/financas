-- Profissional: experiências e habilidades (currículo), metas de carreira, vagas e entrevistas.
create table prof_experiencias (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references usuarios(id) on delete cascade,
  empresa      text not null,
  cargo        text not null,
  vinculo      text not null default 'clt' check (vinculo in ('clt','pj','estagio','freelance','temporario','voluntario')),
  modalidade   text check (modalidade in ('presencial','hibrido','remoto')),
  local        text,
  inicio       date not null,
  fim          date,                         -- null = atual
  descricao    text,
  conquistas   text,                         -- uma por linha
  tecnologias  text[] not null default '{}',
  created_at   timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);

create table prof_habilidades (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references usuarios(id) on delete cascade,
  nome       text not null,
  categoria  text not null default 'tecnica' check (categoria in ('tecnica','ferramenta','dominio','idioma','comportamental')),
  nivel      smallint not null default 3 check (nivel between 1 and 5),
  created_at timestamptz not null default now(),
  unique (user_id, nome)
);

create table prof_metas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references usuarios(id) on delete cascade,
  titulo      text not null,
  descricao   text,
  categoria   text not null default 'carreira' check (categoria in ('carreira','salario','tecnica','certificacao','rede','outro')),
  prazo       date,
  status      text not null default 'aberta' check (status in ('aberta','andamento','concluida','abandonada')),
  progresso   smallint not null default 0 check (progresso between 0 and 100),
  created_at  timestamptz not null default now()
);

create table prof_vagas (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references usuarios(id) on delete cascade,
  empresa              text not null,
  cargo                text not null,
  url                  text,
  fonte                text,                 -- LinkedIn, indicação, site da empresa...
  modalidade           text check (modalidade in ('presencial','hibrido','remoto')),
  local                text,
  vinculo              text check (vinculo in ('clt','pj','estagio','freelance','temporario')),
  salario_min_centavos bigint check (salario_min_centavos is null or salario_min_centavos >= 0),
  salario_max_centavos bigint check (salario_max_centavos is null or salario_max_centavos >= 0),
  status               text not null default 'interesse' check (status in ('interesse','aplicada','em_processo','proposta','aceita','recusada','reprovado','desisti')),
  aplicada_em          date,
  contato              text,
  observacoes          text,
  created_at           timestamptz not null default now()
);

create table prof_entrevistas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references usuarios(id) on delete cascade,
  vaga_id       uuid not null references prof_vagas(id) on delete cascade,
  data          date not null,
  hora          text check (hora is null or hora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  etapa         text not null default 'rh' check (etapa in ('triagem','rh','tecnica','case','gestor','cultura','proposta')),
  entrevistador text,
  link          text,
  resultado     text not null default 'agendada' check (resultado in ('agendada','aprovado','reprovado','aguardando','cancelada')),
  anotacoes     text,
  created_at    timestamptz not null default now()
);

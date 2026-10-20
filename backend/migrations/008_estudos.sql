-- Estudos: cursos (faculdade, cursos livres, certificações) → disciplinas → avaliações;
-- sessões de estudo (horas); livros.
create table estudo_cursos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references usuarios(id) on delete cascade,
  tipo             text not null default 'curso' check (tipo in ('faculdade','pos','curso','certificacao','idioma')),
  nome             text not null,
  instituicao      text,
  status           text not null default 'andamento' check (status in ('planejado','andamento','pausado','concluido','trancado')),
  inicio           date,
  fim_previsto     date,
  concluido_em     date,
  carga_horaria_h  integer check (carga_horaria_h is null or carga_horaria_h > 0),
  media_aprovacao  numeric(4,2) not null default 7 check (media_aprovacao between 0 and 10),
  url              text,
  observacoes      text,
  created_at       timestamptz not null default now()
);

create table estudo_disciplinas (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references usuarios(id) on delete cascade,
  curso_id         uuid references estudo_cursos(id) on delete cascade,
  nome             text not null,
  periodo          text,          -- "2026/2", "Fase 3", "Módulo B"
  status           text not null default 'cursando' check (status in ('a_cursar','cursando','aprovada','reprovada','dispensada')),
  inicio           date,
  fim              date,
  professor        text,
  cor              text not null default '#4f46e5',
  created_at       timestamptz not null default now()
);

create table estudo_avaliacoes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references usuarios(id) on delete cascade,
  disciplina_id uuid not null references estudo_disciplinas(id) on delete cascade,
  tipo          text not null default 'prova' check (tipo in ('prova','apol','discursiva','atividade','trabalho','projeto','outro')),
  titulo        text not null,
  data          date,
  peso          numeric(5,2) not null default 1 check (peso > 0),
  nota          numeric(5,2) check (nota is null or nota >= 0),
  nota_maxima   numeric(5,2) not null default 10 check (nota_maxima > 0),
  observacoes   text,
  created_at    timestamptz not null default now(),
  check (nota is null or nota <= nota_maxima)
);

create table livros (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references usuarios(id) on delete cascade,
  titulo         text not null,
  autor          text,
  status         text not null default 'quero_ler' check (status in ('quero_ler','lendo','lido','abandonado')),
  paginas_total  integer check (paginas_total is null or paginas_total > 0),
  pagina_atual   integer not null default 0 check (pagina_atual >= 0),
  inicio         date,
  fim            date,
  avaliacao      smallint check (avaliacao between 1 and 5),
  notas          text,
  created_at     timestamptz not null default now()
);

create table estudo_sessoes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references usuarios(id) on delete cascade,
  data          date not null,
  minutos       integer not null check (minutos between 1 and 1440),
  curso_id      uuid references estudo_cursos(id) on delete set null,
  disciplina_id uuid references estudo_disciplinas(id) on delete set null,
  livro_id      uuid references livros(id) on delete set null,
  assunto       text,
  created_at    timestamptz not null default now()
);
create index on estudo_sessoes (user_id, data);

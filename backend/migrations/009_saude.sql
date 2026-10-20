-- Saúde (privado do usuário): consultas/exames, remédios e doses tomadas, medidas, treinos.
create table saude_consultas (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references usuarios(id) on delete cascade,
  tipo           text not null default 'consulta' check (tipo in ('consulta','exame','vacina','procedimento','terapia','odonto')),
  titulo         text not null,          -- especialidade ou nome do exame
  profissional   text,
  local          text,
  data           date not null,
  hora           text check (hora is null or hora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  status         text not null default 'agendada' check (status in ('agendada','realizada','cancelada')),
  retorno_em     date,
  valor_centavos bigint check (valor_centavos is null or valor_centavos >= 0),
  resultado      text,
  observacoes    text,
  created_at     timestamptz not null default now()
);

create table saude_remedios (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references usuarios(id) on delete cascade,
  nome        text not null,
  dosagem     text,                       -- "500 mg", "1 comprimido"
  horarios    text[] not null default '{}' check (array_to_string(horarios, ',') ~ '^([0-2][0-9]:[0-5][0-9](,|$))*$'),  -- "08:00", "20:30"
  inicio      date not null default current_date,
  fim         date,                       -- null = uso contínuo
  ativo       boolean not null default true,
  observacoes text,
  created_at  timestamptz not null default now()
);

create table saude_doses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references usuarios(id) on delete cascade,
  remedio_id uuid not null references saude_remedios(id) on delete cascade,
  data       date not null,
  horario    text not null,
  tomado_em  timestamptz not null default now(),
  unique (remedio_id, data, horario)
);

create table saude_medidas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references usuarios(id) on delete cascade,
  data        date not null,
  peso_kg     numeric(5,2) check (peso_kg is null or peso_kg between 20 and 400),
  altura_cm   numeric(5,1) check (altura_cm is null or altura_cm between 50 and 250),
  cintura_cm  numeric(5,1) check (cintura_cm is null or cintura_cm between 30 and 250),
  gordura_pct numeric(4,1) check (gordura_pct is null or gordura_pct between 1 and 70),
  observacoes text,
  created_at  timestamptz not null default now()
);
create index on saude_medidas (user_id, data);

create table saude_treinos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references usuarios(id) on delete cascade,
  data         date not null,
  tipo         text not null default 'musculacao' check (tipo in ('musculacao','corrida','caminhada','bike','natacao','funcional','esporte','alongamento','outro')),
  duracao_min  integer not null check (duracao_min between 1 and 1440),
  distancia_km numeric(6,2) check (distancia_km is null or distancia_km > 0),
  intensidade  smallint check (intensidade between 1 and 5),
  observacoes  text,
  created_at   timestamptz not null default now()
);
create index on saude_treinos (user_id, data);

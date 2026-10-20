create table notas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references usuarios(id) on delete cascade,
  titulo     text not null default '',
  conteudo   text not null default '',
  etiquetas  text[] not null default '{}',
  fixada     boolean not null default false,
  cor        text,
  arquivada  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on notas (user_id, arquivada);
create index on notas using gin (etiquetas);

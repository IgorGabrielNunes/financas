-- Avisos. Pessoais (cada usuário: WhatsApp via CallMeBot ou Telegram) e da casa (grupo no Telegram).
create table notif_config (
  user_id          uuid primary key references usuarios(id) on delete cascade,
  ativo            boolean not null default false,
  canal            text not null default 'callmebot' check (canal in ('callmebot','telegram')),
  telefone         text check (telefone is null or telefone ~ '^\+?[0-9]{10,15}$'),
  apikey           text,                          -- chave do CallMeBot (nunca volta para o front)
  telegram_chat_id text,                          -- preenchido ao vincular pelo robô
  discreto         boolean not null default false,-- sem detalhes (nomes de consultas/remédios) na mensagem
  resumo_hora      text check (resumo_hora is null or resumo_hora ~ '^[0-2][0-9]:[0-5][0-9]$'),  -- null = sem resumo
  antecedencia_min smallint not null default 60 check (antecedencia_min between 5 and 1440),
  avisar_treino    boolean not null default true,
  avisar_remedios  boolean not null default true,
  avisar_consultas boolean not null default true,
  avisar_entrevistas boolean not null default true,
  avisar_refeicoes boolean not null default false,
  silencio_inicio  text check (silencio_inicio is null or silencio_inicio ~ '^[0-2][0-9]:[0-5][0-9]$'),
  silencio_fim     text check (silencio_fim is null or silencio_fim ~ '^[0-2][0-9]:[0-5][0-9]$'),
  updated_at       timestamptz not null default now()
);

-- Grupo da casa no Telegram: resumo das tarefas compartilhadas e contas/faturas vencendo.
create table notif_casa (
  casa_id          uuid primary key references casas(id) on delete cascade,
  ativo            boolean not null default false,
  telegram_chat_id text,
  titulo_grupo     text,
  resumo_hora      text not null default '08:00' check (resumo_hora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  avisar_tarefas   boolean not null default true,
  avisar_contas    boolean not null default true,
  dias_antes_contas smallint not null default 1 check (dias_antes_contas between 0 and 7),
  updated_at       timestamptz not null default now()
);

-- Vínculo com o Telegram: o Vida gera um código; a pessoa manda "/start CODIGO" ao robô
-- (ou "/vincular CODIGO" no grupo) e o webhook grava o chat_id. Código expira em 30 min.
create table notif_vinculos (
  codigo     text primary key,
  user_id    uuid references usuarios(id) on delete cascade,
  casa_id    uuid references casas(id) on delete cascade,
  expira_em  timestamptz not null,
  check ((user_id is null) <> (casa_id is null))
);

-- Deduplicação: cada aviso tem uma chave determinística (ex.: doses:<data>:<hora>:<ids>).
-- O disparador insere antes de enviar; se o envio falhar, apaga para tentar no próximo ciclo.
-- dono = user_id (pessoal) ou casa_id (grupo).
create table notif_enviadas (
  dono       uuid not null,
  chave      text not null,
  enviada_em timestamptz not null default now(),
  primary key (dono, chave)
);
create index on notif_enviadas (enviada_em);

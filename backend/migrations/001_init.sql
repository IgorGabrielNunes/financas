-- =====================================================================
-- Finanças — schema inicial
-- Convenções:
--   * dinheiro SEMPRE em centavos (bigint). Nunca float/numeric no domínio.
--   * datas de negócio em DATE (sem fuso). O driver devolve como string 'YYYY-MM-DD'.
--   * competencia = primeiro dia do mês de referência (ex.: 2026-11-01).
--   * todas as tabelas têm user_id: o app é single-user hoje, multiusuário amanhã sem migração.
-- =====================================================================

create extension if not exists pgcrypto;

create table usuarios (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  nome          text not null,
  senha_hash    text not null,
  created_at    timestamptz not null default now()
);

create table contas (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references usuarios(id) on delete cascade,
  nome                   text not null,
  tipo                   text not null check (tipo in ('corrente','poupanca','carteira','investimento')),
  saldo_inicial_centavos bigint not null default 0,
  cor                    text not null default '#2f6b4f',
  ativa                  boolean not null default true,
  created_at             timestamptz not null default now()
);
create index on contas (user_id);

create table cartoes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references usuarios(id) on delete cascade,
  nome                text not null,
  bandeira            text,
  final               text check (final is null or final ~ '^[0-9]{4}$'), -- só os 4 últimos dígitos
  limite_centavos     bigint not null check (limite_centavos >= 0),
  dia_fechamento      smallint not null check (dia_fechamento between 1 and 31),
  dia_vencimento      smallint not null check (dia_vencimento between 1 and 31),
  conta_pagamento_id  uuid references contas(id) on delete set null,
  cor                 text not null default '#1f2937',
  ativo               boolean not null default true,
  created_at          timestamptz not null default now()
);
create index on cartoes (user_id);

create table categorias (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references usuarios(id) on delete cascade,
  nome     text not null,
  tipo     text not null check (tipo in ('receita','despesa')),
  cor      text not null default '#64748b',
  unique (user_id, nome, tipo)
);

-- Regra de recorrência (template). As instâncias mensais são linhas em `lancamentos`.
create table recorrencias (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references usuarios(id) on delete cascade,
  descricao                text not null,
  tipo                     text not null check (tipo in ('receita','despesa')),
  valor_previsto_centavos  bigint not null check (valor_previsto_centavos > 0),  -- conta variável (luz): use uma estimativa
  dia_mes                  smallint not null check (dia_mes between 1 and 31),
  meio                     text not null check (meio in ('debito','credito','pix','dinheiro','boleto','transferencia')),
  categoria_id             uuid references categorias(id) on delete set null,
  conta_id                 uuid references contas(id) on delete set null,
  cartao_id                uuid references cartoes(id) on delete set null,
  inicio                   date not null,  -- competência inicial (1º dia do mês)
  fim                      date,           -- competência final inclusiva (null = sem fim)
  ativa                    boolean not null default true,
  created_at               timestamptz not null default now(),
  check ((meio = 'credito') = (cartao_id is not null))
);
create index on recorrencias (user_id);

create table faturas (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references usuarios(id) on delete cascade,
  cartao_id            uuid not null references cartoes(id) on delete cascade,
  competencia          date not null,          -- mês do VENCIMENTO
  data_fechamento      date not null,
  data_vencimento      date not null,
  valor_pago_centavos  bigint not null default 0,
  pago_em              date,
  conta_pagamento_id   uuid references contas(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (cartao_id, competencia)
);
create index on faturas (user_id, data_vencimento);

create table lancamentos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references usuarios(id) on delete cascade,
  tipo             text not null check (tipo in ('receita','despesa')),
  descricao        text not null,
  valor_centavos   bigint not null check (valor_centavos > 0),  -- valor TOTAL (no crédito parcelado: total da compra)
  data             date not null,                               -- data da compra / do pagamento
  meio             text not null check (meio in ('debito','credito','pix','dinheiro','boleto','transferencia')),
  conta_id         uuid references contas(id) on delete set null,
  cartao_id        uuid references cartoes(id) on delete cascade,   -- exclusão bloqueada na aplicação; cascade só p/ excluir usuário
  categoria_id     uuid references categorias(id) on delete set null,
  parcelas_total   smallint not null default 1 check (parcelas_total between 1 and 48),
  status           text not null default 'realizado' check (status in ('previsto','realizado')),
  recorrencia_id   uuid references recorrencias(id) on delete set null,
  competencia      date,   -- preenchido só em instâncias de recorrência
  observacao       text,
  created_at       timestamptz not null default now(),
  check ((meio = 'credito') = (cartao_id is not null)),
  check (meio <> 'credito' or tipo = 'despesa'),
  check (parcelas_total = 1 or meio = 'credito')
);
create index on lancamentos (user_id, data);
create index on lancamentos (conta_id);
-- idempotência da geração de recorrências: 1 instância por regra por mês
create unique index lancamentos_recorrencia_competencia_uk
  on lancamentos (recorrencia_id, competencia) where recorrencia_id is not null;

create table parcelas (
  id              uuid primary key default gen_random_uuid(),
  lancamento_id   uuid not null references lancamentos(id) on delete cascade,
  fatura_id       uuid not null references faturas(id) on delete cascade,
  numero          smallint not null,
  valor_centavos  bigint not null,
  unique (lancamento_id, numero)
);
create index on parcelas (fatura_id);

create table comprovantes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references usuarios(id) on delete cascade,
  lancamento_id  uuid not null references lancamentos(id) on delete cascade,
  storage_key    text not null,
  nome_original  text not null,
  mime           text not null,
  tamanho_bytes  integer not null,
  created_at     timestamptz not null default now()
);
create index on comprovantes (lancamento_id);

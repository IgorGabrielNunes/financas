-- =====================================================================
-- Pessoas da casa (perfis), titular de contas/cartões, dívidas e inadimplência.
-- Salário, parcelas de dívida e parcelas de acordo viram recorrências VINCULADAS
-- (origem + origem_id): a fonte da verdade é o perfil/dívida, a recorrência é derivada.
-- =====================================================================

create table pessoas (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references usuarios(id) on delete cascade,
  nome              text not null,
  cargo             text,
  salario_centavos  bigint check (salario_centavos is null or salario_centavos > 0), -- LÍQUIDO (o que cai na conta)
  dia_salario       smallint check (dia_salario between 1 and 31),
  conta_salario_id  uuid references contas(id) on delete set null,
  cor               text not null default '#2f6b4f',
  created_at        timestamptz not null default now(),
  unique (user_id, nome)
);

alter table contas
  add column pessoa_id uuid references pessoas(id) on delete set null,
  add column cartao_debito boolean not null default false;

alter table cartoes
  add column pessoa_id uuid references pessoas(id) on delete set null;

alter table recorrencias
  add column pessoa_id uuid references pessoas(id) on delete set null,
  add column origem text not null default 'manual' check (origem in ('manual','salario','divida','acordo')),
  add column origem_id uuid,
  add constraint recorrencias_origem_ck check ((origem = 'manual') = (origem_id is null));
create unique index recorrencias_origem_uk on recorrencias (origem, origem_id) where origem <> 'manual';

-- Dívidas contratadas (parcelas fixas): consignado, empréstimo, financiamento...
create table dividas (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references usuarios(id) on delete cascade,
  pessoa_id               uuid references pessoas(id) on delete set null,
  tipo                    text not null check (tipo in ('consignado','emprestimo','financiamento_veiculo','financiamento_imovel','cheque_especial','outro')),
  credor                  text not null,
  descricao               text,
  valor_contratado_centavos bigint check (valor_contratado_centavos is null or valor_contratado_centavos > 0),
  taxa_mensal_pct         numeric(6,3) check (taxa_mensal_pct is null or taxa_mensal_pct >= 0),
  parcelas_total          smallint not null check (parcelas_total between 1 and 600),
  valor_parcela_centavos  bigint not null check (valor_parcela_centavos > 0),
  primeira_parcela        date not null,
  forma_pagamento         text not null check (forma_pagamento in ('folha','debito','boleto','pix')),
  conta_id                uuid references contas(id) on delete set null,
  quitada_em              date,
  observacao              text,
  created_at              timestamptz not null default now()
);
create index on dividas (user_id);

-- Inadimplência: o que ficou para trás, por quê, e como está a negociação.
create table inadimplencias (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references usuarios(id) on delete cascade,
  pessoa_id                   uuid references pessoas(id) on delete set null,
  credor                      text not null,
  origem                      text not null check (origem in ('faculdade','cartao','emprestimo','financiamento','conta_consumo','aluguel','outro')),
  motivo                      text,           -- o que levou à inadimplência, nas palavras de quem viveu
  valor_original_centavos     bigint not null check (valor_original_centavos > 0),
  valor_atual_centavos        bigint check (valor_atual_centavos is null or valor_atual_centavos > 0), -- com juros/multa, se souber
  desde                       date not null,  -- vencimento da primeira parcela não paga
  negativado                  boolean not null default false,
  status                      text not null default 'em_aberto' check (status in ('em_aberto','negociando','acordo','quitada')),
  acordo_parcelas             smallint check (acordo_parcelas between 1 and 120),
  acordo_valor_parcela_centavos bigint check (acordo_valor_parcela_centavos > 0),
  acordo_primeira_parcela     date,
  acordo_forma_pagamento      text check (acordo_forma_pagamento in ('boleto','pix','debito')),
  acordo_conta_id             uuid references contas(id) on delete set null,
  quitada_em                  date,
  observacao                  text,
  created_at                  timestamptz not null default now(),
  check (status <> 'acordo' or (acordo_parcelas is not null and acordo_valor_parcela_centavos is not null and acordo_primeira_parcela is not null))
);
create index on inadimplencias (user_id);

-- Metas (viagem, cofrinho, reserva...) e investimentos.
-- Regra central: dinheiro guardado numa meta ou aplicado num investimento SAI do saldo da conta de origem
-- (não entra no "disponível"), sem virar despesa do mês. Resgate/retirada volta para a conta escolhida.

-- Taxas de referência da casa (CDI, Selic, IPCA, TR). Atualizadas do Banco Central (SGS) ou ajustadas à mão.
create table taxas_referencia (
  casa_id       uuid primary key references casas(id) on delete cascade,
  selic_aa      numeric(7,4) not null default 13.75,   -- % a.a. (meta Copom)
  cdi_aa        numeric(7,4) not null default 13.65,   -- % a.a. (base 252)
  ipca_aa       numeric(7,4) not null default 5.00,    -- % acumulado 12 meses
  tr_am         numeric(7,4) not null default 0.15,    -- % a.m. (poupança)
  fonte         text not null default 'padrao' check (fonte in ('padrao', 'bcb', 'manual')),
  atualizado_em timestamptz not null default now()
);

create table metas (
  id                  uuid primary key default gen_random_uuid(),
  casa_id             uuid not null references casas(id) on delete cascade,
  usuario_id          uuid references usuarios(id) on delete set null,  -- dono; null = meta da casa
  nome                text not null,
  tipo                text not null check (tipo in ('viagem', 'investimento', 'cofrinho', 'reserva', 'compra', 'outro')),
  icone               text,
  cor                 text not null default '#0f4b3a',
  valor_alvo_centavos bigint not null check (valor_alvo_centavos > 0),
  data_alvo           date,
  arquivada           boolean not null default false,
  observacao          text,
  created_at          timestamptz not null default now()
);
create index on metas (casa_id);

-- guardar (+) / retirar (−). Com conta_id, o valor sai/volta do saldo da conta.
create table metas_movimentos (
  id             uuid primary key default gen_random_uuid(),
  casa_id        uuid not null references casas(id) on delete cascade,
  meta_id        uuid not null references metas(id) on delete cascade,
  data           date not null,
  valor_centavos bigint not null check (valor_centavos <> 0),
  conta_id       uuid references contas(id) on delete set null,
  descricao      text,
  created_at     timestamptz not null default now()
);
create index on metas_movimentos (meta_id, data);
create index on metas_movimentos (conta_id) where conta_id is not null;

create table investimentos (
  id          uuid primary key default gen_random_uuid(),
  casa_id     uuid not null references casas(id) on delete cascade,
  usuario_id  uuid references usuarios(id) on delete set null,
  conta_id    uuid references contas(id) on delete set null,      -- banco/corretora onde o dinheiro está
  meta_id     uuid references metas(id) on delete set null,
  nome        text not null,
  tipo        text not null check (tipo in ('cdb', 'lci_lca', 'tesouro_selic', 'tesouro_ipca', 'tesouro_prefixado',
                                            'poupanca', 'fundo_di', 'caixinha', 'acoes', 'fii', 'cripto', 'outro')),
  indexador   text not null check (indexador in ('cdi', 'selic', 'ipca', 'prefixado', 'poupanca', 'nenhum')),
  -- cdi/selic: % do índice (102 = 102% do CDI); ipca: taxa real % a.a. (IPCA + 6,5); prefixado: % a.a.
  taxa        numeric(8,4) not null default 100 check (taxa >= 0),
  taxa_adm_aa numeric(6,4) not null default 0 check (taxa_adm_aa >= 0),
  isento_ir   boolean not null default false,
  liquidez    text not null default 'diaria' check (liquidez in ('diaria', 'vencimento')),
  vencimento  date,
  ativo       boolean not null default true,
  observacao  text,
  created_at  timestamptz not null default now()
);
create index on investimentos (casa_id);
create index on investimentos (conta_id) where conta_id is not null;

-- aporte/resgate. conta_id = de onde saiu / para onde voltou; null = não mexe em conta
-- (ex.: dinheiro que já estava aplicado antes de usar o Vida).
create table investimentos_movimentos (
  id              uuid primary key default gen_random_uuid(),
  casa_id         uuid not null references casas(id) on delete cascade,
  investimento_id uuid not null references investimentos(id) on delete cascade,
  tipo            text not null check (tipo in ('aporte', 'resgate')),
  data            date not null,
  valor_centavos  bigint not null check (valor_centavos > 0),
  conta_id        uuid references contas(id) on delete set null,
  observacao      text,
  created_at      timestamptz not null default now()
);
create index on investimentos_movimentos (investimento_id, data);
create index on investimentos_movimentos (conta_id) where conta_id is not null;

-- saldo que o app do banco mostra numa data: corrige a estimativa (rendimento real)
create table investimentos_saldos (
  id              uuid primary key default gen_random_uuid(),
  casa_id         uuid not null references casas(id) on delete cascade,
  investimento_id uuid not null references investimentos(id) on delete cascade,
  data            date not null,
  valor_centavos  bigint not null check (valor_centavos >= 0),
  created_at      timestamptz not null default now(),
  unique (investimento_id, data)
);

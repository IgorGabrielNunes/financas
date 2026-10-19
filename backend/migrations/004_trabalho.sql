-- =====================================================================
-- Vínculo de trabalho (CLT): histórico de salários, férias gozadas e parâmetros
-- para 13º, férias e simulação de rescisão.
-- =====================================================================

alter table pessoas
  add column data_admissao             date,
  add column dependentes_ir            smallint not null default 0 check (dependentes_ir between 0 and 20),
  add column outros_descontos_centavos bigint not null default 0 check (outros_descontos_centavos >= 0), -- VT, plano, etc.
  add column paga_mes_seguinte         boolean not null default true,  -- salário do mês cai até o 5º dia útil do mês seguinte
  add column ferias_quitadas_ate       date,     -- fim do último período aquisitivo já resolvido antes do app
  add column saque_aniversario         boolean not null default false,
  add column saldo_fgts_centavos       bigint check (saldo_fgts_centavos is null or saldo_fgts_centavos >= 0),
  add column saldo_fgts_em             date,
  add column gerar_decimo              boolean not null default true;

-- Salário por vigência: o valor vale a partir de `vigencia` até a próxima linha.
create table salarios (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references usuarios(id) on delete cascade,
  pessoa_id         uuid not null references pessoas(id) on delete cascade,
  vigencia          date not null,
  bruto_centavos    bigint not null check (bruto_centavos > 0),
  liquido_centavos  bigint check (liquido_centavos is null or liquido_centavos > 0), -- se souber o exato do holerite
  cargo             text,
  observacao        text,
  created_at        timestamptz not null default now(),
  unique (pessoa_id, vigencia)
);

create table ferias_gozadas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references usuarios(id) on delete cascade,
  pessoa_id   uuid not null references pessoas(id) on delete cascade,
  inicio      date not null,
  dias        smallint not null check (dias between 5 and 30),
  abono_dias  smallint not null default 0 check (abono_dias between 0 and 10),
  created_at  timestamptz not null default now()
);
create index on ferias_gozadas (pessoa_id);

-- 13º vira fixo vinculado (1ª parcela em novembro, 2ª em dezembro)
alter table recorrencias drop constraint recorrencias_origem_check;
alter table recorrencias add constraint recorrencias_origem_check
  check (origem in ('manual','salario','divida','acordo','decimo1','decimo2'));

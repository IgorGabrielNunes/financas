-- Importação de fatura de cartão (CSV/OFX/JSON). Cada importação é um lote: dá para ver o histórico
-- e desfazer tudo de uma vez (apaga os lançamentos criados por ela).
create table importacoes (
  id             uuid primary key default gen_random_uuid(),
  casa_id        uuid not null references casas(id) on delete cascade,
  cartao_id      uuid not null references cartoes(id) on delete cascade,
  competencia    date not null,               -- fatura escolhida (1º dia do mês do vencimento)
  arquivo_nome   text,
  formato        text not null check (formato in ('csv','ofx','json')),
  qtd            integer not null default 0,
  total_centavos bigint not null default 0,   -- soma do que entrou nesta fatura (parcelas do mês)
  criado_por     uuid references usuarios(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index on importacoes (casa_id, created_at desc);

alter table lancamentos add column importacao_id uuid references importacoes(id) on delete set null;
create index on lancamentos (importacao_id) where importacao_id is not null;

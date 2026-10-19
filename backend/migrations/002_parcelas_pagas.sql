-- Onboarding de compras parceladas em andamento: "comprei em julho em 12x e já paguei 3".
-- As parcelas 1..parcelas_pagas_antes não geram linhas em `parcelas` (foram pagas antes do app).
alter table lancamentos
  add column parcelas_pagas_antes smallint not null default 0,
  add constraint lancamentos_parcelas_pagas_ck check (parcelas_pagas_antes >= 0 and parcelas_pagas_antes < parcelas_total);

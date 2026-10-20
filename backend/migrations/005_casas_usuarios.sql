-- =====================================================================
-- Casa (household) e usuários.
-- Dados financeiros passam a ser DA CASA (todos os membros veem e editam);
-- módulos pessoais (tarefas, notas...) são do USUÁRIO.
-- Migração sem perda: cada usuário existente vira uma casa com o MESMO id,
-- então `user_id` → `casa_id` mantém todos os valores.
-- =====================================================================

create table casas (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  created_at timestamptz not null default now()
);
insert into casas (id, nome) select id, 'Casa de ' || split_part(nome, ' ', 1) from usuarios;

alter table usuarios
  add column casa_id   uuid references casas(id) on delete cascade,
  add column papel     text not null default 'admin' check (papel in ('admin', 'membro')),
  add column ativo     boolean not null default true,
  add column trocar_senha boolean not null default false;
update usuarios set casa_id = id;
alter table usuarios alter column casa_id set not null;
create index on usuarios (casa_id);

-- tabelas financeiras: user_id → casa_id (FK passa a apontar para casas)
do $$
declare t text;
begin
  foreach t in array array['contas','cartoes','categorias','recorrencias','faturas','lancamentos','comprovantes',
                           'pessoas','dividas','inadimplencias','salarios','ferias_gozadas'] loop
    execute format('alter table %I drop constraint if exists %I', t, t || '_user_id_fkey');
    execute format('alter table %I rename column user_id to casa_id', t);
    execute format('alter table %I add constraint %I foreign key (casa_id) references casas(id) on delete cascade', t, t || '_casa_id_fkey');
  end loop;
end $$;

-- usuário ↔ perfil (Pessoas): o salário, cargo e férias do usuário moram no perfil vinculado
alter table usuarios add column pessoa_id uuid references pessoas(id) on delete set null;
create unique index usuarios_pessoa_uk on usuarios (pessoa_id) where pessoa_id is not null;
-- vincula automaticamente pelo primeiro nome (ex.: usuário "Igor Gabriel" ↔ perfil "Igor")
update usuarios u set pessoa_id = (
  select p.id from pessoas p
   where p.casa_id = u.casa_id and lower(split_part(p.nome, ' ', 1)) = lower(split_part(u.nome, ' ', 1))
   order by p.created_at limit 1);

-- nomes de constraints acompanham a coluna renomeada (só cosmético, mas evita confusão em erros)
alter table categorias rename constraint categorias_user_id_nome_tipo_key to categorias_casa_id_nome_tipo_key;
alter table pessoas rename constraint pessoas_user_id_nome_key to pessoas_casa_id_nome_key;

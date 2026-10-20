// Registro único dos módulos do Vida. Módulo novo = uma pasta + uma linha aqui.
// Todos rodam atrás do hook `autenticar` (ver app.ts).
import { conta } from './conta/rotas.js';
import { financas } from './financas/index.js';
import { tarefas } from './tarefas/rotas.js';
import { notas } from './notas/rotas.js';
import { estudos } from './estudos/rotas.js';
import { saude } from './saude/rotas.js';
import { academia } from './academia/rotas.js';
import { avisos } from './avisos/rotas.js';
import { projetos } from './projetos/rotas.js';
import { profissional } from './profissional/rotas.js';
import { hoje } from './hoje.js';

export const MODULOS = [conta, financas, tarefas, notas, estudos, saude, academia, projetos, profissional, avisos, hoje];

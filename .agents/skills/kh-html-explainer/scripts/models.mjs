import { check, label, parseInput, record } from './component-input.mjs';
import { renderGraph, validateGraph } from './diagram.mjs';

export function renderState(source, index, escape) {
  const { title, direction, states, transitions, initial, final = [] } =
    parseInput(source, ['title', 'direction', 'states', 'transitions', 'initial', 'final']);
  const graph = validateGraph({ title, direction, nodes: states, edges: transitions });
  const ids = new Set(states.map(({ id }) => id));
  check(ids.has(initial), 'initial は定義済みの状態 ID を指定してください');
  check(Array.isArray(final) && final.length <= states.length && new Set(final).size === final.length
    && final.every((id) => ids.has(id)), 'final は重複しない状態 ID の配列を指定してください');
  const terminal = new Set(final);
  return renderGraph({
    ...graph,
    nodes: graph.nodes.map(({ id, label }) => {
      const roles = [id === initial ? '開始' : '', terminal.has(id) ? '終了' : ''].filter(Boolean);
      return { id, label: roles.length ? `${label}（${roles.join('・')}）` : label };
    }),
  }, index, escape);
}

const multiplicities = new Set(['0..1', '1', '0..*', '1..*']);

export function renderEr(source, index, escape) {
  const { title, direction = 'LR', entities, relations } =
    parseInput(source, ['title', 'direction', 'entities', 'relations']);
  check(Array.isArray(entities) && entities.length >= 1 && entities.length <= 12, 'entities は1〜12件です');
  check(Array.isArray(relations) && relations.length <= 24, 'relations は0〜24件です');

  const details = new Map();
  const nodes = entities.map((entity) => {
    check(record(entity, ['id', 'label', 'fields']), 'エンティティのフィールドが不正です');
    const { id, label: name, fields } = entity;
    check(Array.isArray(fields) && fields.length >= 1 && fields.length <= 12, 'fields は各エンティティにつき1〜12件です');
    const fieldNames = new Set();
    const captions = fields.map((field) => {
      check(Array.isArray(field) && (field.length === 2 || field.length === 3)
        && label(field[0], 40) && label(field[1], 32)
        && (field.length === 2 || ['PK', 'FK', 'UK', 'PK/FK'].includes(field[2])), 'fields は [名前, 型, 任意のキー] の形式です');
      const [fieldName, type, key] = field;
      check(!fieldNames.has(fieldName), '同じエンティティのフィールド名は一意にしてください');
      fieldNames.add(fieldName);
      return `${fieldName} · ${type}${key ? ` · ${key}` : ''}`;
    });
    details.set(id, captions);
    return { id, label: name };
  });
  const multiplicity = new Map();
  const edges = relations.map((relation) => {
    check(Array.isArray(relation) && relation.length === 4
      && multiplicities.has(relation[2]) && multiplicities.has(relation[3]),
    'relations は [左のID, 右のID, 左の多重度, 右の多重度] の形式です');
    const [from, to, left, right] = relation;
    check(typeof from === 'string' && typeof to === 'string', 'relations の ID は文字列で指定してください');
    multiplicity.set(`${from}:${to}`, [left, right]);
    return [from, to, `${left} : ${right}`];
  });

  return renderGraph({ ...validateGraph({ title, direction, nodes, edges }), details, multiplicity, arrows: false }, index, escape);
}

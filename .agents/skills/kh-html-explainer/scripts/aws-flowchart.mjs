import { label } from './component-input.mjs';

const conciseNames = new Set('alb ecr ecs ec2 iam lambda rds s3 sns sqs vpc waf'.split(' '));
const names = new Map([
  ['application load balancer', 'alb'], ['api gateway', 'api-gateway'],
  ['cloudfront', 'cloudfront'], ['cloudtrail', 'cloudtrail'], ['cloudwatch', 'cloudwatch'],
  ['codebuild', 'codebuild'], ['codecommit', 'codecommit'], ['codepipeline', 'codepipeline'],
  ['dynamodb', 'dynamodb'], ['eventbridge', 'eventbridge'], ['fargate', 'fargate'],
  ['organizations', 'organizations'], ['route 53', 'route53'], ['route53', 'route53'],
  ...[...conciseNames].map(name => [name, name]),
]);

function service(name) {
  const text = name.toLowerCase().trim().replace(/^(aws|amazon)\s+/, '');
  for (const [prefix, icon] of names) {
    if (text === prefix || (text.startsWith(prefix) && /[\s（(［[:：/]/.test(text[prefix.length] ?? ''))) return icon;
  }
}

function boundaryType(name) {
  if (/^AWS Organizations\b/i.test(name)) return 'organization';
  if (/\bOU\b/i.test(name)) return 'ou';
  if (/^AZ\b/i.test(name)) return 'az';
  if (/\bVPC\b/i.test(name)) return 'vpc';
  if (name.includes('アカウント') || /\baccount\b/i.test(name) || name === 'ログ保管') return 'account';
  if (/サブネット|^プライベート|\bsubnet\b/i.test(name)) return 'subnet';
  if (/タスク|\btask\b/i.test(name)) return 'task';
  return 'service';
}

export function awsFlowchartFromMermaid({ title, description, flow, icons }) {
  if (!flow?.simple) return;
  const { groups, nodes, edges, direction } = flow;
  if (!['TB', 'TD', 'BT', 'LR', 'RL'].includes(direction) || !nodes.length
    || nodes.length + groups.length > 64 || edges.length > 128) return;
  if (![...nodes, ...groups].every(item => label(item.name, 100))
    || !edges.every(([, , text]) => !text || label(text, 75))) return;

  const serviceIds = new Set(nodes.map(node => node.icon || service(node.name)).filter(Boolean));
  const awsTitle = [title, ...groups.map(group => group.name), ...nodes.map(node => node.name)]
    .some(name => /\b(?:aws|amazon)\b/i.test(name));
  // Keep generic labels such as "Lambda" out of the AWS theme unless the surrounding graph establishes context.
  if (!(Object.keys(icons).length || awsTitle || serviceIds.size >= 2
    || [...serviceIds].some(id => !conciseNames.has(id) && id !== 'api-gateway'))) return;

  const parents = new Map();
  const pairs = new Map();
  const nodeIds = new Set(nodes.map(node => node.id));
  const ids = new Set([...nodeIds, ...groups.map(group => group.id)]);
  if (ids.size !== groups.length + nodes.length) return;
  for (const group of groups) {
    if (!group.members.length) return;
    for (const member of group.members) {
      if (!ids.has(member) || parents.has(member)) return;
      parents.set(member, group.id);
    }
  }
  for (const [from, to] of edges) {
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to) || pairs.get(from)?.has(to)) return;
    if (!pairs.has(from)) pairs.set(from, new Set());
    pairs.get(from).add(to);
  }
  const depths = new Map();
  for (const { id } of groups) {
    const seen = new Set([id]);
    for (let parent = parents.get(id); parent; parent = parents.get(parent)) {
      if (seen.has(parent)) return;
      seen.add(parent);
    }
    depths.set(id, seen.size);
  }
  const resources = nodes.map(node => ({
    key: node.id, name: node.name, icon: node.icon || service(node.name), parent: parents.get(node.id),
  }));
  const boundaries = [...groups].sort((a, b) => depths.get(a.id) - depths.get(b.id)).map(group => ({
    key: group.id, name: group.name, type: boundaryType(group.name), parent: parents.get(group.id),
    icon: service(group.name) === 'codecommit' ? 'codecommit' : undefined,
  }));
  const entries = new Map([...resources, ...boundaries].map(entry => [entry.key, entry]));
  return { title, description, direction: direction === 'TD' ? 'TB' : direction, nodes: resources, boundaries, edges, entries };
}

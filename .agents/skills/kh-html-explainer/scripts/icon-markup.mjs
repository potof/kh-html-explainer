const iconLabelPattern = /^@aws:([a-z][a-z0-9-]{0,39}) (.+)$/;

export function readIconLabel(value, usedIcons) {
  const match = value.match(iconLabelPattern);
  if (!match) {
    if (value.startsWith('@aws:')) throw new Error('アイコンは @aws:service-id ラベル の形式で指定してください');
    return { name: value };
  }
  const [, icon, name] = match;
  usedIcons.add(icon);
  return { icon, name };
}

export function iconUse(icon, x, y, size) {
  const format = value => Number(value.toFixed(1));
  return `<use href="#aws-icon-${icon}" x="${format(x)}" y="${format(y)}" width="${size}" height="${size}" aria-hidden="true"/>`;
}

export function captionIcon(icon) {
  return `<svg class="aws-title-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">${iconUse(icon, 0, 0, 18)}</svg>`;
}

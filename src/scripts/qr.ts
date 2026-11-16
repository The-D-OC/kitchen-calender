import qrcode from 'qrcode-generator';

/** QR code as a crisp SVG (built from DOM nodes, no innerHTML) */
export function qrSvg(text: string): SVGSVGElement {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const quiet = 3;
  svg.setAttribute('viewBox', `${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', 'qr');
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('x', String(-quiet));
  bg.setAttribute('y', String(-quiet));
  bg.setAttribute('width', String(n + quiet * 2));
  bg.setAttribute('height', String(n + quiet * 2));
  bg.setAttribute('fill', '#fff');
  svg.append(bg);
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#111318');
  svg.append(path);
  return svg;
}

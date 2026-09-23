'use strict';

/* ------------------------------------------------------------------
   Dibujo de una botella.

   La base siempre sale del pack (assets/pack): un PNG ya dibujado. Encima
   se pueden pegar imágenes, que se recortan a la silueta usando la propia
   transparencia del PNG como máscara. Por eso todo se monta como SVG en
   vez de como <img> suelta: es lo que permite el recorte.
   ------------------------------------------------------------------ */

const Botellas = (() => {

  let pack = [];
  let tenidos = {};          // id -> imagen ya recoloreada, si la hay
  const porId = new Map();

  const usarTenidos = (m) => { tenidos = m || {}; };

  /**
   * Las botellas y los lomos de libro viven en el mismo catálogo, marcados por
   * familia: comparten el recorte por transparencia, el recoloreado y las
   * imágenes que se pegan encima. Lo único propio del libro es el texto
   * vertical del lomo.
   */
  function usarPack(lista, libros = []) {
    pack = [
      ...lista.map((p) => ({ ...p, familia: p.familia || 'botella' })),
      ...libros.map((p) => ({ ...p, familia: 'libro' })),
    ];
    porId.clear();
    for (const p of pack) porId.set(p.id, p);
  }

  const familiaDe = (g) => (g && g.tipo === 'libro' ? 'libro' : 'botella');

  const base = (id) => porId.get(id) || pack[0] || null;
  const existe = (id) => porId.has(id);

  /** Luminancia de un color en hexadecimal, para decidir cómo fundir el texto. */
  function luz(hex) {
    const n = String(hex).replace('#', '');
    const c = n.length === 3 ? n.split('').map((x) => x + x).join('') : n;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) || 0);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const sinTildes = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  /**
   * Botella del pack que mejor pega con el nombre de una carpeta: "Minecraft"
   * encuentra minecraft.png. Si no hay nada parecido, devuelve una lisa fija
   * para ese nombre, para que la misma carpeta salga siempre igual.
   */
  function sugerirBase(nombre) {
    const q = sinTildes(nombre || '');
    if (!q) return graficoPorDefecto().base;

    const conClave = pack.map((p) => ({ p, k: sinTildes(p.nombre) }));
    const exacta = conClave.find((c) => c.k === q);
    if (exacta) return exacta.p.id;

    if (q.length >= 4) {
      const parcial = conClave
        .filter((c) => !c.p.lisa && c.k.length >= 3 && (c.k.includes(q) || q.includes(c.k)))
        .sort((a, b) => Math.abs(a.k.length - q.length) - Math.abs(b.k.length - q.length))[0];
      if (parcial) return parcial.p.id;
    }

    const lisas = pack.filter((p) => p.lisa);
    if (!lisas.length) return pack[0]?.id || null;
    let h = 0;
    for (const c of q) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return lisas[h % lisas.length].id;
  }

  function graficoPorDefecto(i = 0, familia = 'botella') {
    const dentro = pack.filter((p) => p.familia === familia);
    const candidatas = familia === 'botella'
      ? (dentro.filter((p) => p.lisa).length ? dentro.filter((p) => p.lisa) : dentro)
      : dentro;
    const elegida = candidatas[i % (candidatas.length || 1)];
    return { tipo: familia, base: elegida ? elegida.id : null, capas: [] };
  }

  /**
   * Marcado SVG de una botella.
   * @param {object} g        {base, capas:[{id, img, x, y, w, rot, ar}]}
   * @param {object} opciones {uid, imagenes, seleccion}
   */
  function svg(g, { uid = 'b', imagenes = {}, seleccion = null, sinTinte = false, texto = '' } = {}) {
    const b = base(g.base);
    if (!b) return '<svg viewBox="0 0 1 1"></svg>';

    const esLibro = familiaDe(g) === 'libro';

    /* El grosor solo tiene sentido en un lomo: se ensancha el lienzo y se
       estira SOLO la imagen del libro, que es un rectángulo plano y aguanta
       bien. El texto no se toca: el SVG conserva proporciones, así que las
       letras crecen a la par pero sin deformarse, y siguen centradas en el
       lomo. Antes se estiraba todo el dibujo y el texto salía achatado. */
    const grosor = esLibro ? Math.min(2.2, Math.max(0.5, g.grosor || 1)) : 1;
    const W = b.w * grosor;
    const H = b.h;
    const dibujo = sinTinte ? b.src : (tenidos[b.id] || b.src);

    const capas = (g.capas || []).map((cp) => {
      const datos = imagenes[cp.img];
      if (!datos) return '';
      const w = cp.w * W;
      const h = w / (cp.ar || 1);
      const x = cp.x * W - w / 2;
      const y = cp.y * H - h / 2;
      const cx = x + w / 2;
      const cy = y + h / 2;
      return `<image href="${esc(datos)}" x="${x}" y="${y}" width="${w}" height="${h}"
                preserveAspectRatio="none" transform="rotate(${cp.rot || 0} ${cx} ${cy})"
                opacity="${cp.op ?? 1}" data-capa="${esc(cp.id)}"/>`;
    }).join('');

    const marcas = (g.capas || []).filter((cp) => cp.id === seleccion).map((cp) => {
      const w = cp.w * W;
      const h = w / (cp.ar || 1);
      const x = cp.x * W - w / 2;
      const y = cp.y * H - h / 2;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#3B241C"
                stroke-width="2" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"
                transform="rotate(${cp.rot || 0} ${x + w / 2} ${y + h / 2})"/>`;
    }).join('');

    // El centro se mueve con el lienzo, pero el tamaño de letra sale del ancho
    // NATURAL del lomo: engordar el libro no cambia el texto, solo el dibujo.
    const lomo = esLibro ? textoDelLomo(b, texto, W / 2) : '';

    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
      style="aspect-ratio:${W}/${H}" preserveAspectRatio="xMidYMax meet">
      <defs>
        <!-- El filtro deja el RGB en blanco y conserva el alfa, así la máscara
             por luminancia (la estándar) equivale a recortar por transparencia. -->
        <filter id="alfa-${uid}" x="0" y="0" width="100%" height="100%">
          <feColorMatrix type="matrix"
            values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/>
        </filter>
        <mask id="msk-${uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
          <image href="${esc(dibujo)}" x="0" y="0" width="${W}" height="${H}"
                 filter="url(#alfa-${uid})"/>
        </mask>
      </defs>
      <image href="${esc(dibujo)}" x="0" y="0" width="${W}" height="${H}"/>
      <g mask="url(#msk-${uid})">${capas}</g>
      ${lomo}
      ${marcas}
    </svg>`;
  }

  /**
   * El texto del lomo, girado y escrito con el color que ya viene calculado
   * para ese libro. El tamaño sale del ancho del lomo, pero se reduce si el
   * texto no cabría a lo largo: mejor letra pequeña que texto cortado.
   */
  function textoDelLomo(b, texto, cx) {
    const t = String(texto || '').trim();
    if (!t) return '';

    const largo = b.h * 0.66;                       // hueco disponible, sin las hojas
    const porAncho = b.w * 0.46;
    // Cinzel es de capitales anchas y va con algo de aire entre letras.
    const porLargo = largo / (t.length * 0.72);
    const tam = Math.max(6, Math.min(porAncho, porLargo));

    const cy = b.h * 0.58;

    /* El texto se funde con el lomo en vez de quedar pegado encima: oscuro
       sobre claro multiplica, claro sobre oscuro aclara. Así los adornos del
       libro se transparentan a través de las letras, como impresas. */
    const mezcla = luz(b.texto || '#ffffff') < luz(b.lomo || '#808080') ? 'multiply' : 'screen';

    return `<text x="${cx}" y="${cy}" transform="rotate(-90 ${cx} ${cy})"
      text-anchor="middle" dominant-baseline="central"
      font-family="Cinzel, 'Iowan Old Style', Georgia, serif"
      font-weight="700" font-size="${tam.toFixed(1)}"
      letter-spacing="${(tam * 0.07).toFixed(2)}"
      fill="${esc(b.texto || '#ffffff')}"
      style="mix-blend-mode:${mezcla}">${esc(t)}</text>`;
  }

  return {
    usarPack, usarTenidos, svg, graficoPorDefecto, sugerirBase, base, existe, familiaDe,
    lista: (familia) => (familia ? pack.filter((p) => p.familia === familia) : pack),
  };
})();

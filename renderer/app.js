'use strict';

/* ------------------------------------------------------------------
   Estantería — lógica del renderer

   Coordenadas: todo en fracciones (0–1) respecto a la IMAGEN de fondo,
   nunca a la pantalla, para que se vea igual en cualquier resolución.

   Una balda es un TRAMO: {id, y, x0, x1}. Este fondo tiene dos tramos por
   fila más el suelo, así que las botellas solo se posan donde hay madera.

   Hay dos clases de objeto:
     · botellas: son las carpetas REALES de tu escritorio. La lista la manda el
       proceso principal y se actualiza sola cuando creas, borras o renombras
       algo. Lo único que guardamos de cada una es qué dibujo lleva y dónde está.
     · pósters: láminas en la pared, por detrás de las botellas.

   Y varias DISTRIBUCIONES (modo juego, modo estudio…): las botellas y los
   pósters son los mismos, lo que cambia en cada una es dónde está cada
   cosa y qué está guardado en el cajón.
   ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);

const elEscenario = $('#escenario');
const elPared = $('#pared');
const elEstanterias = $('#estanterias');
const elTinta = $('#tinta');
const elBaldas = $('#baldas');
const elBotellas = $('#botellas');
const elCarteles = $('#carteles');
const elCajon = $('#cajon');
const elCajonLista = $('#cajon-lista');
const elSeleccion = $('#seleccion');
const elAviso = $('#aviso');

const HUECO_PX = 10;
const ALTO_POR_DEFECTO = 0.16;
const ANCHO_POSTER = 0.11;

// La papelera no es una carpeta del escritorio: es la del sistema, y se dibuja
// llena o vacía según lo que tenga dentro.
const PAPELERA = 'papelera:sistema';

// Medidas tomadas de assets/estanterias.png: tres filas de dos tramos y el
// suelo. La cara superior de cada tabla es donde apoyan las botellas.
const BALDAS_POR_DEFECTO = [
  { id: 'b1', y: 0.302, x0: 0.004, x1: 0.343 },
  { id: 'b2', y: 0.302, x0: 0.643, x1: 0.996 },
  { id: 'b3', y: 0.545, x0: 0.004, x1: 0.343 },
  { id: 'b4', y: 0.545, x0: 0.643, x1: 0.996 },
  { id: 'b5', y: 0.787, x0: 0.004, x1: 0.345 },
  { id: 'b6', y: 0.787, x0: 0.643, x1: 0.996 },
  { id: 'b7', y: 0.965, x0: 0.004, x1: 0.996 },
];

let imagenes = {};
let carpetas = [];        // carpetas del escritorio, tal cual están en disco
let escritorio = '';
let papeleraLlena = false;
let st = null;
let modo = 'fondo';
let anclaje = 'encima';
let ajustandoBaldas = false;
let rect = { x: 0, y: 0, w: 0, h: 0 };
let seleccion = null;      // id del objeto seleccionado en modo edición
let resaltada = null;      // id bajo el cursor cuando no llegan eventos de ratón
const nodos = new Map();

const uid = () => Math.random().toString(36).slice(2, 10);
const limpioId = (s) => {
  const txt = String(s);
  let h = 0;
  for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) >>> 0;
  return `${txt.replace(/[^a-zA-Z0-9_-]/g, '').slice(-24)}-${h.toString(36)}`;
};
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// --- Modelo -------------------------------------------------------------

function escenaNueva(nombre) {
  return { nombre, botellas: {}, carteles: {} };
}

function estadoInicial() {
  return {
    version: 5,
    ajuste: 'cover',
    baldas: JSON.parse(JSON.stringify(BALDAS_POR_DEFECTO)),
    graficos: {},   // ruta de la carpeta -> {grafico}
    color: colorPorDefecto(),
    posters: {},
    escenas: { e1: escenaNueva('Principal') },
    escena: 'e1',
  };
}

const escena = () => st.escenas[st.escena] || (st.escenas[st.escena] = escenaNueva('Principal'));

/**
 * Todo lo que se puede colocar. Las botellas salen de las carpetas del disco:
 * si una carpeta no tiene dibujo asignado, se le propone uno por su nombre.
 */
function objetos() {
  const lista = carpetas.map((c) => ({
    id: c.ruta,
    tipo: 'botella',
    clase: c.tipo || 'carpeta',
    nombre: c.nombre,
    ruta: c.ruta,
    grafico: graficoDe(c),
  }));
  lista.push({
    id: PAPELERA,
    tipo: 'botella',
    clase: 'papelera',
    nombre: papeleraLlena ? 'Papelera' : 'Papelera vacía',
    grafico: { base: papeleraLlena ? 'papelera-llena.png' : 'papelera-vacia.png', capas: [] },
  });

  for (const [id, p] of Object.entries(st.posters)) {
    lista.push({ id, tipo: 'poster', nombre: p.nombre, ruta: p.ruta, img: p.img, ar: p.ar, marco: p.marco });
  }
  return lista;
}

/**
 * El dibujo guardado de una carpeta, o uno propuesto por su nombre. Si el
 * guardado ya no existe —el pack cambió— se vuelve a proponer, para que no
 * quede un hueco en la balda.
 */
function graficoDe(c) {
  const g = st.graficos[c.ruta] && st.graficos[c.ruta].grafico;
  if (g && g.base && Botellas.existe(g.base)) return g;
  return { tipo: g?.tipo || 'botella', base: Botellas.sugerirBase(c.nombre), capas: [], texto: g?.texto };
}

const esCarpeta = (id) => id === PAPELERA || carpetas.some((c) => c.ruta === id);

const objeto = (id) => objetos().find((o) => o.id === id);
const esPoster = (id) => Boolean(st.posters[id]);

/**
 * Dónde está algo en la distribución actual, o null si no está puesto.
 *
 * Guardar algo en el cajón no borra su ficha: la deja marcada. Antes se
 * borraba, y al arrancar la app no podía distinguir entre "nunca se ha
 * colocado" y "la quitaste tú", así que te la devolvía a la balda.
 */
function sitio(id) {
  const d = fichas(id)[id];
  return !d || d.guardado ? null : d;
}

const fichas = (id) => (esPoster(id) ? escena().carteles : escena().botellas);

/** ¿Sabemos ya algo de esto en esta distribución, aunque esté en el cajón? */
const conocido = (id) => Boolean(fichas(id)[id]);

function colocar(id, datos) {
  const mapa = fichas(id);
  if (datos === null) mapa[id] = { ...(mapa[id] || {}), guardado: true };
  else mapa[id] = { ...(mapa[id] || {}), ...datos, guardado: false };
}

const balda = (id) => st.baldas.find((b) => b.id === id) || null;

/* --- Capas ------------------------------------------------------------
   Las botellas pueden solaparse a propósito, así que además de la balda
   guardan una capa (z). Dentro de un mismo tramo manda la capa; entre
   tramos manda la altura, para que las baldas de arriba queden detrás. */

const zDe = (id) => sitio(id)?.z ?? 0;
const zTodas = () => Object.values(escena().botellas).map((d) => d.z ?? 0);
const yDe = (id) => balda(sitio(id)?.balda)?.y ?? 0;

function traerAlFrente(id) {
  const s = sitio(id);
  if (!s) return;
  s.z = Math.max(0, ...zTodas()) + 1;
  guardar(); pintar();
}

function enviarAlFondo(id) {
  const s = sitio(id);
  if (!s) return;
  s.z = Math.min(0, ...zTodas()) - 1;
  guardar(); pintar();
}

/** Intercambia la capa con la botella vecina de su mismo tramo. */
function mover1Capa(id, dir) {
  const s = sitio(id);
  if (!s) return;
  const hermanas = idsEnBalda(s.balda)
    .map((o) => ({ o, z: zDe(o) }))
    .sort((a, b) => a.z - b.z || a.o.localeCompare(b.o));
  const i = hermanas.findIndex((h) => h.o === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= hermanas.length) return;

  const otra = sitio(hermanas[j].o);
  const tmp = hermanas[j].z;
  otra.z = hermanas[i].z;
  s.z = tmp;
  if (otra.z === s.z) { s.z += dir; }   // por si ambas eran 0
  guardar(); pintar();
}
const baldasOrdenadas = () => [...st.baldas].sort((a, b) => a.y - b.y || a.x0 - b.x0);

let temporizador = null;
function guardar() {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { temporizador = null; window.estanteria.guardar(st); }, 250);
}

/** Guarda ya lo que estuviera pendiente (al recargar o cerrar la ventana). */
function guardarYa() {
  if (!temporizador || !st) return;
  clearTimeout(temporizador);
  temporizador = null;
  window.estanteria.guardar(st);
}
window.addEventListener('beforeunload', guardarYa);

// --- Geometría ----------------------------------------------------------

function calcularRect() {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const iw = elPared.naturalWidth || cw;
  const ih = elPared.naturalHeight || ch;
  const escala = st.ajuste === 'contain' ? Math.min(cw / iw, ch / ih) : Math.max(cw / iw, ch / ih);

  rect = { x: (cw - iw * escala) / 2, y: (ch - ih * escala) / 2, w: iw * escala, h: ih * escala };
  Object.assign(elEscenario.style, {
    left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`,
  });
}

const anchoFraccion = (el) => (el.getBoundingClientRect().width || 1) / rect.w;

/** Espera a que la imagen de dentro esté cargada para poder medir el objeto. */
function esperarDibujo(el) {
  if (!el) return Promise.resolve();
  const img = el.querySelector('image, img');
  if (!img) return Promise.resolve();
  const src = img.getAttribute('href') || img.getAttribute('src');
  if (!src) return Promise.resolve();
  return new Promise((res) => {
    const i = new Image();
    i.onload = i.onerror = () => res();
    i.src = src;
  });
}

/**
 * Alto máximo de una botella en un tramo: el hueco hasta la balda de encima,
 * para que ninguna tape la madera de arriba.
 */
function altoMaximo(idBalda) {
  const b = balda(idBalda);
  if (!b) return 0.5;
  const encima = st.baldas
    .filter((o) => o.y < b.y - 0.005 && o.x1 > b.x0 && o.x0 < b.x1)
    .reduce((m, o) => Math.max(m, o.y), 0);
  return Math.max(0.05, (b.y - encima) * 0.9);
}

// --- Nodos --------------------------------------------------------------

const ASAS_BOTELLA = '<i class="asa asa-alto" data-asa="alto"></i>';
const ASAS_POSTER = '<i class="asa asa-tam" data-asa="tam"></i><i class="asa asa-giro" data-asa="giro"></i>';

function contenido(o) {
  return o.tipo === 'poster'
    ? Carteles.html(o, imagenes)
    : Botellas.svg(o.grafico, {
      uid: 'v-' + limpioId(o.id),
      imagenes,
      // En un lomo, si no has escrito nada se pone el nombre de la carpeta.
      texto: o.grafico.texto ?? o.nombre,
    });
}

function crearNodo(o) {
  const el = document.createElement('div');
  el.className = o.tipo === 'poster' ? 'poster' : 'botella';
  el.dataset.id = o.id;
  el.dataset.tipo = o.tipo;
  if (o.clase) el.dataset.clase = o.clase;
  rellenarNodo(el, o);
  el.addEventListener('pointerdown', alPulsar);
  el.addEventListener('wheel', alRodar, { passive: false });
  // El id se lee del nodo: al renombrar una carpeta cambia y el nodo se reutiliza.
  el.addEventListener('dblclick', () => alAbrir(el.dataset.id));
  return el;
}

function rellenarNodo(el, o) {
  el.innerHTML = `${contenido(o)}<span class="etiqueta"></span>`
    + (o.tipo === 'poster' ? ASAS_POSTER : ASAS_BOTELLA);
  el.querySelector('.etiqueta').textContent = o.nombre;
}

function refrescarNodo(id) {
  const el = nodos.get(id);
  const o = objeto(id);
  if (el && o) rellenarNodo(el, o);
}

// --- Pintado ------------------------------------------------------------

function pintar() {
  const lista = objetos();
  const vivos = new Set(lista.map((o) => o.id));
  for (const [id, el] of nodos) {
    if (!vivos.has(id)) { el.remove(); nodos.delete(id); }
  }
  if (seleccion && !vivos.has(seleccion)) seleccion = null;

  const alCajon = [];

  for (const o of lista) {
    let el = nodos.get(o.id);
    if (!el) { el = crearNodo(o); nodos.set(o.id, el); }
    el.classList.toggle('sel', o.id === seleccion);

    const s = sitio(o.id);
    if (!s) { alCajon.push(el); continue; }

    if (o.tipo === 'poster') {
      if (el.parentElement !== elCarteles) elCarteles.appendChild(el);
      el.style.left = `${(s.x * 100).toFixed(3)}%`;
      el.style.top = `${(s.y * 100).toFixed(3)}%`;
      el.style.width = `${(s.w * 100).toFixed(3)}%`;
      el.style.height = '';
      el.style.rotate = `${s.rot || 0}deg`;
    } else {
      const bal = balda(s.balda);
      if (!bal) { alCajon.push(el); continue; }
      if (el.parentElement !== elBotellas) elBotellas.appendChild(el);
      el.style.left = `${(s.x * 100).toFixed(3)}%`;
      el.style.bottom = `${((1 - bal.y) * 100).toFixed(3)}%`;
      el.style.height = `${(s.alto * 100).toFixed(3)}%`;
    }
  }

  for (const el of alCajon) {
    if (el.parentElement !== elCajonLista) elCajonLista.appendChild(el);
    el.style.left = el.style.top = el.style.bottom = el.style.zIndex = el.style.rotate = '';
    el.style.height = '100%';
    el.style.width = '';
  }

  ordenarCapas();
  elCajon.classList.toggle('vacio', alCajon.length === 0);
  pintarBaldas();
  pintarSeleccion();
}

/** Traduce balda + capa a un z-index concreto para cada botella. */
function ordenarCapas() {
  objetos()
    .filter((o) => o.tipo === 'botella' && sitio(o.id) && balda(sitio(o.id).balda))
    .sort((a, b) => yDe(a.id) - yDe(b.id) || zDe(a.id) - zDe(b.id) || sitio(a.id).x - sitio(b.id).x)
    .forEach((o, i) => { const el = nodos.get(o.id); if (el) el.style.zIndex = String(100 + i); });
}

function pintarBaldas() {
  elBaldas.replaceChildren(...st.baldas.map((b, i) => {
    const l = document.createElement('div');
    l.className = 'balda';
    l.dataset.id = b.id;
    l.dataset.i = String(i + 1);
    l.style.top = `${(b.y * 100).toFixed(3)}%`;
    l.style.left = `${(b.x0 * 100).toFixed(3)}%`;
    l.style.width = `${((b.x1 - b.x0) * 100).toFixed(3)}%`;
    l.innerHTML = '<i class="tirador izq"></i><i class="tirador der"></i>';
    l.addEventListener('pointerdown', alPulsarBalda);
    l.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (st.baldas.length <= 1) return;
      st.baldas = st.baldas.filter((x) => x.id !== b.id);
      for (const e2 of Object.values(st.escenas)) {
        for (const [id, d] of Object.entries(e2.botellas)) if (d.balda === b.id) delete e2.botellas[id];
      }
      guardar(); pintar();
    });
    return l;
  }));
}

function pintarEscenas() {
  const sel = $('#escenas');
  sel.innerHTML = Object.entries(st.escenas)
    .map(([id, e]) => `<option value="${escHtml(id)}" ${id === st.escena ? 'selected' : ''}>${escHtml(e.nombre)}</option>`)
    .join('');
  window.estanteria.avisarEscenas({
    lista: Object.entries(st.escenas).map(([id, e]) => ({ id, nombre: e.nombre })),
    actual: st.escena,
  });
}

// --- Selección ----------------------------------------------------------

function seleccionar(id) {
  if (seleccion === id) return;
  seleccion = id;
  for (const [k, el] of nodos) el.classList.toggle('sel', k === id);
  pintarSeleccion();
}

function pintarSeleccion() {
  const o = seleccion ? objeto(seleccion) : null;
  const s = seleccion ? sitio(seleccion) : null;
  elSeleccion.hidden = !(o && s && modo === 'editar' && !ajustandoBaldas);
  if (elSeleccion.hidden) return;

  $('#sel-nombre').textContent = o.nombre || 'Sin nombre';
  const tam = $('#sel-tam');
  const poster = o.tipo === 'poster';

  tam.min = poster ? 2 : 3;
  tam.max = poster ? 60 : Math.round(altoMaximo(s.balda) * 100);
  tam.value = ((poster ? s.w : s.alto) * 100).toFixed(1);
  $('#sel-num').textContent = `${Math.round(tam.value)}%`;
  const libro = !poster && Botellas.familiaDe(o.grafico) === 'libro';
  $('#sel-giro-caja').hidden = !poster;
  $('#sel-grosor-caja').hidden = !libro;
  $('#sel-capas').hidden = poster;
  if (poster) $('#sel-giro').value = s.rot || 0;
  if (libro) $('#sel-grosor').value = Math.round((o.grafico.grosor || 1) * 100);
}

function cambiarTamano(v) {
  const s = sitio(seleccion);
  if (!s) return;
  if (esPoster(seleccion)) s.w = Math.min(0.6, Math.max(0.02, v));
  else s.alto = Math.min(altoMaximo(s.balda), Math.max(0.03, v));
  pintar();
  guardar();
}

// --- Colocación ---------------------------------------------------------

const idsEnBalda = (idBalda) => Object.keys(escena().botellas)
  .filter((id) => esCarpeta(id) && !escena().botellas[id].guardado
    && escena().botellas[id].balda === idBalda && nodos.has(id));

function resolverSolapes(idBalda) {
  const bal = balda(idBalda);
  if (!bal) return;

  const cosas = idsEnBalda(idBalda)
    .map((id) => ({ id, x: escena().botellas[id].x, w: anchoFraccion(nodos.get(id)) }))
    .sort((a, b) => a.x - b.x);
  if (!cosas.length) return;

  const hueco = HUECO_PX / rect.w;

  for (let k = 0; k < cosas.length; k++) {
    const min = k === 0
      ? bal.x0 + cosas[0].w / 2
      : cosas[k - 1].x + cosas[k - 1].w / 2 + hueco + cosas[k].w / 2;
    if (cosas[k].x < min) cosas[k].x = min;
  }

  const ultima = cosas[cosas.length - 1];
  const desborde = ultima.x + ultima.w / 2 - bal.x1;
  if (desborde > 0) {
    for (let k = cosas.length - 1; k >= 0; k--) {
      cosas[k].x -= desborde;
      if (k > 0) {
        const max = cosas[k].x - cosas[k].w / 2 - hueco - cosas[k - 1].w / 2;
        if (cosas[k - 1].x <= max) break;
      }
    }
  }

  for (const c of cosas) {
    escena().botellas[c.id].x = Math.min(bal.x1 - c.w / 2, Math.max(bal.x0 + c.w / 2, c.x));
  }
}

/** Reparte botellas por los tramos, de arriba abajo y de izquierda a derecha. */
function repartir(ids) {
  const hueco = HUECO_PX / rect.w;
  const orden = baldasOrdenadas();

  // Una botella guardada en el cajón se dibuja al tamaño del cajón, así que
  // medirla ahí daría un ancho falso: primero la ponemos en una balda.
  for (const id of ids) {
    const d = escena().botellas[id] || {};
    const bal = d.balda && balda(d.balda) ? d.balda : orden[0].id;
    colocar(id, { balda: bal, x: d.x ?? 0.5, alto: Math.min(d.alto || ALTO_POR_DEFECTO, altoMaximo(bal)) });
  }
  pintar();

  let i = 0;
  let cursor = orden[0].x0 + hueco;

  for (const id of ids) {
    const w = anchoFraccion(nodos.get(id));
    while (i < orden.length - 1 && cursor + w > orden[i].x1) {
      i += 1;
      cursor = orden[i].x0 + hueco;
    }
    const d = escena().botellas[id] || {};
    colocar(id, {
      balda: orden[i].id,
      x: cursor + w / 2,
      alto: Math.min(d.alto || ALTO_POR_DEFECTO, altoMaximo(orden[i].id)),
    });
    cursor += w + hueco;
  }
  guardar(); pintar();
}

function ordenar(criterio) {
  const lista = objetos().filter((o) => o.tipo === 'botella' && sitio(o.id));
  if (criterio === 'nombre') lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (criterio === 'altura') lista.sort((a, b) => sitio(b.id).alto - sitio(a.id).alto);
  repartir(lista.map((o) => o.id));
}

/** Primer tramo con sitio libre para una botella de ancho w. */
function huecoLibre(w, excluir = null) {
  const hueco = HUECO_PX / rect.w;
  for (const bal of baldasOrdenadas()) {
    const bordes = idsEnBalda(bal.id)
      .filter((o) => o !== excluir)
      .map((o) => escena().botellas[o].x + anchoFraccion(nodos.get(o)) / 2);
    const derecha = bordes.length ? Math.max(...bordes) : bal.x0;
    const x = derecha + hueco + w / 2;
    if (x + w / 2 <= bal.x1) return { balda: bal.id, x };
  }
  return null;
}

// --- Sincronización con el escritorio -----------------------------------

/**
 * Aplica una lista nueva de carpetas. Si en el mismo cambio ha desaparecido una
 * y ha aparecido otra, damos por hecho que la has renombrado y le pasamos su
 * dibujo y su sitio, para que no salte a otra balda por cambiarle el nombre.
 */
async function sincronizar(lista, { colocarNuevas = true } = {}) {
  const antes = new Set(carpetas.map((c) => c.ruta));
  const ahora = new Set(lista.map((c) => c.ruta));
  const idas = [...antes].filter((r) => !ahora.has(r));
  const nuevas = [...ahora].filter((r) => !antes.has(r));

  carpetas = lista;

  if (idas.length === 1 && nuevas.length === 1) {
    mudar(idas[0], nuevas[0]);
    pintar();
    guardar();
    return;
  }

  pintar();
  if (!colocarNuevas || !nuevas.length) { guardar(); return; }

  // Las carpetas nuevas entran solas en el primer hueco libre.
  await Promise.all(nuevas.map((r) => esperarDibujo(nodos.get(r))));
  for (const ruta of nuevas) {
    if (conocido(ruta)) continue;
    const el = nodos.get(ruta);
    if (!el) continue;
    ponerEnLaEstanteria(ruta);
  }
  guardar();
  pintar();
}

/** Coloca una botella en el primer hueco libre, o la deja en el cajón. */
function ponerEnLaEstanteria(id) {
  const primera = baldasOrdenadas()[0];
  colocar(id, { balda: primera.id, x: primera.x0, alto: Math.min(ALTO_POR_DEFECTO, altoMaximo(primera.id)) });
  pintar();

  const libre = huecoLibre(anchoFraccion(nodos.get(id)), id);
  if (libre) {
    colocar(id, { ...libre, alto: Math.min(ALTO_POR_DEFECTO, altoMaximo(libre.balda)) });
    resolverSolapes(libre.balda);
  } else {
    colocar(id, null);
  }
}

/** Lleva dibujo y colocación de una ruta a otra (al renombrar una carpeta). */
function mudar(viejo, nuevo) {
  if (st.graficos[viejo]) { st.graficos[nuevo] = st.graficos[viejo]; delete st.graficos[viejo]; }
  for (const e of Object.values(st.escenas)) {
    if (e.botellas[viejo]) { e.botellas[nuevo] = e.botellas[viejo]; delete e.botellas[viejo]; }
  }
  if (seleccion === viejo) seleccion = nuevo;
  const el = nodos.get(viejo);
  if (el) { nodos.delete(viejo); el.dataset.id = nuevo; nodos.set(nuevo, el); }
}

// --- Crear y editar -----------------------------------------------------

async function renombrar(id, nombre) {
  if (id === PAPELERA) return null;
  const r = await window.estanteria.renombrarCarpeta(id, nombre);
  if (!r) {
    await dialogo({ titulo: 'No se pudo renombrar', detalle: 'Puede que el nombre ya esté en uso o que la carpeta esté abierta.', aceptarTxt: 'Vale' });
    return null;
  }
  if (r.ruta !== id) mudar(id, r.ruta);
  carpetas = await window.estanteria.carpetas();
  guardar(); pintar();
  return r.ruta;
}

async function renombrarInteractivo(id) {
  const o = objeto(id);
  if (!o) return;
  if (esPoster(id)) { editar(id); return; }
  const nombre = await pedirTexto('Nuevo nombre de la carpeta', o.nombre);
  if (nombre) await renombrar(id, nombre);
}

async function nuevoPoster() {
  const elegidas = await window.estanteria.importarImagenes();
  if (!elegidas || !elegidas.length) return;

  let ultimo = null;
  for (const img of elegidas) {
    imagenes[img.id] = img.datos;
    const id = 'poster:' + uid();
    st.posters[id] = {
      nombre: 'Póster',
      img: img.id,
      ar: await proporcion(img.datos),
      marco: 'madera',
      ruta: null,
    };
    colocar(id, { x: 0.42 + Math.random() * 0.14, y: 0.2 + Math.random() * 0.12, w: ANCHO_POSTER, rot: 0 });
    ultimo = id;
  }
  pintar();
  seleccionar(ultimo);
  guardar();
  editar(ultimo);
}

const proporcion = (datos) => new Promise((res) => {
  const i = new Image();
  i.onload = () => res(i.naturalWidth / i.naturalHeight || 1);
  i.onerror = () => res(1);
  i.src = datos;
});

function editar(id) {
  if (id === PAPELERA) return;
  const poster = esPoster(id);
  const o = objeto(id);
  if (!o) return;

  Editor.abrir({
    tipo: poster ? 'poster' : 'botella',
    esNueva: false,
    imagenes,
    item: poster
      ? { id, nombre: o.nombre, ruta: o.ruta, img: o.img, ar: o.ar, marco: o.marco }
      : { id, nombre: o.nombre, ruta: o.ruta, grafico: JSON.parse(JSON.stringify(o.grafico)) },
    alGuardar: async (b) => {
      let idFinal = id;
      if (poster) {
        st.posters[id] = { nombre: b.nombre, ruta: b.ruta, img: b.img, ar: b.ar, marco: b.marco };
      } else {
        // El nombre de la botella es el de la carpeta: cambiarlo la renombra.
        // Primero el renombrado, porque cambia la ruta y con ella su clave.
        if (b.nombre && b.nombre !== o.nombre) idFinal = (await renombrar(id, b.nombre)) || id;
        st.graficos[idFinal] = { ...(st.graficos[idFinal] || {}), grafico: b.grafico };
      }
      refrescarNodo(idFinal);
      guardar(); pintar();
    },
    alEliminar: () => (poster ? borrarPoster(id) : tirarCarpeta(id)),
  });
}

const eliminar = (id) => {
  if (id === PAPELERA) return;
  return esPoster(id) ? borrarPoster(id) : tirarCarpeta(id);
};

function borrarPoster(id) {
  for (const e of Object.values(st.escenas)) delete e.carteles[id];
  delete st.posters[id];
  if (seleccion === id) seleccion = null;
  guardar(); pintar();
}

/** Manda la carpeta a la papelera del sistema; nunca borra sin más. */
async function tirarCarpeta(id) {
  if (id === PAPELERA) return;
  const o = objeto(id);
  if (!o || !o.ruta) return;
  const ok = await confirmar(`¿Enviar "${o.nombre}" a la papelera?`,
    'Se mueve la carpeta de verdad, con lo que tenga dentro. Podrás recuperarla desde la papelera.');
  if (!ok) return;

  if (await window.estanteria.tirarCarpeta(id)) {
    for (const e of Object.values(st.escenas)) delete e.botellas[id];
    delete st.graficos[id];
    if (seleccion === id) seleccion = null;
    carpetas = await window.estanteria.carpetas();
    guardar(); pintar();
  }
}

function alAbrir(id) {
  if (id === PAPELERA) { window.estanteria.abrirPapelera(); return; }
  const o = objeto(id);
  if (!o) return;
  if (modo === 'editar') { editar(id); return; }
  if (o.ruta) window.estanteria.abrirRuta(o.ruta);
}

async function refrescarPapelera() {
  papeleraLlena = await window.estanteria.papeleraEstado();
  refrescarNodo(PAPELERA);
  pintar();
}

// --- Distribuciones -----------------------------------------------------

async function escenaNuevaInteractiva() {
  const nombre = await pedirTexto('Nombre de la distribución', '');
  if (!nombre) return;
  const id = 'e' + uid();
  // Parte de una copia de la actual: casi siempre quieres retocar, no empezar de cero.
  st.escenas[id] = {
    nombre,
    botellas: JSON.parse(JSON.stringify(escena().botellas)),
    carteles: JSON.parse(JSON.stringify(escena().carteles)),
  };
  st.escena = id;
  guardar(); pintarEscenas(); pintar();
}

async function escenaRenombrar() {
  const nombre = await pedirTexto('Nuevo nombre', escena().nombre);
  if (!nombre) return;
  escena().nombre = nombre;
  guardar(); pintarEscenas();
}

function escenaBorrar() {
  const ids = Object.keys(st.escenas);
  if (ids.length <= 1) return;
  delete st.escenas[st.escena];
  st.escena = Object.keys(st.escenas)[0];
  seleccion = null;
  guardar(); pintarEscenas(); pintar();
}

function cambiarEscena(id) {
  if (!st.escenas[id] || id === st.escena) return;
  st.escena = id;
  seleccion = null;
  guardar(); pintarEscenas(); pintar();
}

// --- Pregunta de texto (window.prompt no existe en Electron) -------------

function dialogo({ titulo, detalle = '', valor = null, aceptarTxt = 'Aceptar' }) {
  const caja = $('#pregunta');
  const campo = $('#pregunta-valor');
  const det = $('#pregunta-det');

  $('#pregunta-txt').textContent = titulo;
  det.textContent = detalle;
  det.hidden = !detalle;
  campo.hidden = valor === null;
  campo.value = valor || '';
  $('#pregunta-si').textContent = aceptarTxt;
  caja.hidden = false;
  if (valor === null) $('#pregunta-si').focus();
  else { campo.focus(); campo.select(); }

  return new Promise((res) => {
    const cerrar = (v) => {
      caja.hidden = true;
      $('#pregunta-form').removeEventListener('submit', aceptar);
      $('#pregunta-no').removeEventListener('click', cancelar);
      res(v);
    };
    const aceptar = (e) => { e.preventDefault(); cerrar(valor === null ? true : (campo.value.trim() || null)); };
    const cancelar = () => cerrar(valor === null ? false : null);
    $('#pregunta-form').addEventListener('submit', aceptar);
    $('#pregunta-no').addEventListener('click', cancelar);
  });
}

const pedirTexto = (titulo, valor) => dialogo({ titulo, valor: valor ?? '' });
const confirmar = (titulo, detalle) => dialogo({ titulo, detalle, aceptarTxt: 'Sí, adelante' });

// --- Arrastre y asas ----------------------------------------------------

let arrastre = null;

function alPulsar(e) {
  if (ajustandoBaldas || e.button !== 0 || Editor.abierto()) return;
  if (modo !== 'editar') { arrastrarEnFondo(e); return; }
  e.preventDefault();
  e.stopPropagation();

  const el = e.currentTarget;
  const id = el.dataset.id;
  seleccionar(id);

  const asa = e.target.dataset?.asa;
  if (asa) { empezarAsa(e, el, id, asa); return; }

  const poster = esPoster(id);
  const s = sitio(id) || {};
  const desdeCajon = el.parentElement === elCajonLista;

  if (poster) {
    const w = (s.w || ANCHO_POSTER);
    el.classList.add('arrastrando');
    elCarteles.appendChild(el);
    el.style.height = '';
    el.style.width = `${(w * 100).toFixed(3)}%`;
    const caja = el.getBoundingClientRect();
    arrastre = {
      el, id, poster: true, w,
      dx: desdeCajon ? 0 : e.clientX - (caja.left + caja.width / 2),
      dy: desdeCajon ? 0 : e.clientY - (caja.top + caja.height / 2),
    };
  } else {
    const alto = (s.alto || ALTO_POR_DEFECTO) * rect.h;
    el.classList.add('arrastrando');
    elBotellas.appendChild(el);
    el.style.height = `${alto}px`;
    if (desdeCajon) {
      arrastre = { el, id, dx: 0, dy: alto / 2, alto };
    } else {
      const caja = el.getBoundingClientRect();
      arrastre = { el, id, dx: e.clientX - (caja.left + caja.width / 2), dy: e.clientY - caja.bottom, alto };
    }
  }

  el.setPointerCapture(e.pointerId);
  moverArrastre(e);
  el.addEventListener('pointermove', moverArrastre);
  el.addEventListener('pointerup', soltarArrastre);
  el.addEventListener('pointercancel', soltarArrastre);
}

function moverArrastre(e) {
  if (!arrastre) return;
  const { el, id } = arrastre;

  if (arrastre.poster) {
    el.style.left = `${e.clientX - arrastre.dx - rect.x}px`;
    el.style.top = `${e.clientY - arrastre.dy - rect.y}px`;
  } else {
    el.style.left = `${e.clientX - arrastre.dx - rect.x}px`;
    el.style.bottom = `${rect.h - (e.clientY - arrastre.dy - rect.y)}px`;
  }

  const c = elCajon.getBoundingClientRect();
  arrastre.enCajon = e.clientX >= c.left && e.clientX <= c.right && e.clientY >= c.top && e.clientY <= c.bottom;
  elCajon.classList.toggle('encima', Boolean(arrastre.enCajon));

  // ¿Lo estamos soltando dentro de la papelera?
  const pap = nodos.get(PAPELERA);
  arrastre.enPapelera = false;
  if (pap && id !== PAPELERA && !arrastre.enCajon && !arrastre.poster && sitio(PAPELERA)) {
    const p = pap.getBoundingClientRect();
    arrastre.enPapelera = e.clientX >= p.left && e.clientX <= p.right
      && e.clientY >= p.top && e.clientY <= p.bottom;
  }
  pap?.classList.toggle('destino', Boolean(arrastre.enPapelera));

  const destino = arrastre.poster || arrastre.enCajon ? null : baldaMasCercana(e);
  for (const l of elBaldas.children) l.classList.toggle('destino', l.dataset.id === destino);
}

/** Tramo más cercano al punto de apoyo de lo que estamos arrastrando. */
const baldaMasCercana = (e) => baldaCercaDe(e.clientX - arrastre.dx, e.clientY - arrastre.dy);

function soltarArrastre(e) {
  if (!arrastre) return;
  const { el, id } = arrastre;

  el.classList.remove('arrastrando');
  el.removeEventListener('pointermove', moverArrastre);
  el.removeEventListener('pointerup', soltarArrastre);
  el.removeEventListener('pointercancel', soltarArrastre);
  try { el.releasePointerCapture(e.pointerId); } catch (_) { /* nada */ }
  elCajon.classList.remove('encima');
  nodos.get(PAPELERA)?.classList.remove('destino');
  for (const l of elBaldas.children) l.classList.remove('destino');

  const anterior = arrastre.poster ? null : (sitio(id) || {}).balda;

  if (arrastre.enPapelera) {
    // Vuelve a su sitio; si confirmas, se va a la papelera del sistema.
    const previo = sitio(id);
    arrastre = null;
    pintar();
    if (previo) tirarCarpeta(id);
    return;
  }

  if (arrastre.enCajon) {
    colocar(id, null);
  } else if (arrastre.poster) {
    colocar(id, {
      x: (e.clientX - arrastre.dx - rect.x) / rect.w,
      y: (e.clientY - arrastre.dy - rect.y) / rect.h,
      w: arrastre.w,
      rot: (sitio(id) || {}).rot || 0,
    });
  } else {
    const bal = baldaMasCercana(e);
    const w = anchoFraccion(el);
    const b = balda(bal);
    if (!b) { arrastre = null; pintar(); return; }
    colocar(id, {
      balda: bal,
      // Solo se limita a la madera: dos botellas pueden solaparse a propósito.
      x: Math.min(b.x1 - w / 2, Math.max(b.x0 + w / 2, (e.clientX - arrastre.dx - rect.x) / rect.w)),
      alto: Math.min(arrastre.alto / rect.h, altoMaximo(bal)),
      z: sitio(id)?.z ?? 0,
    });
  }

  el.style.height = '';
  arrastre = null;
  guardar();
  pintar();
}

/** Asas: redimensionar y girar tirando del propio objeto. */
function empezarAsa(e, el, id, clase) {
  const caja = el.getBoundingClientRect();
  const centro = { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 };
  const base = caja.bottom;

  const mover = (ev) => {
    const s = sitio(id);
    if (!s) return;
    if (clase === 'alto') {
      s.alto = Math.min(altoMaximo(s.balda), Math.max(0.03, (base - ev.clientY) / rect.h));
    } else if (clase === 'tam') {
      const d = Math.hypot(ev.clientX - centro.x, ev.clientY - centro.y);
      const diag = Math.hypot(1, 1 / (objeto(id).ar || 1)) / 2;
      s.w = Math.min(0.6, Math.max(0.02, d / rect.w / diag));
    } else if (clase === 'giro') {
      const a = Math.atan2(ev.clientY - centro.y, ev.clientX - centro.x) * 180 / Math.PI + 90;
      s.rot = Math.max(-25, Math.min(25, Math.round(a)));
    }
    pintar();
  };

  const soltar = () => {
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', soltar);
    guardar(); pintar();
  };

  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', soltar);
}

function alRodar(e) {
  if (modo !== 'editar' || ajustandoBaldas || Editor.abierto()) return;
  const id = e.currentTarget.dataset.id;
  const s = sitio(id);
  if (!s) return;
  e.preventDefault();
  seleccionar(id);
  const paso = Math.sign(e.deltaY) * (esPoster(id) ? 0.008 : 0.012);
  cambiarTamano((esPoster(id) ? s.w : s.alto) - paso);
}

// --- Ajuste de baldas ---------------------------------------------------

function alPulsarBalda(e) {
  if (!ajustandoBaldas || e.button !== 0) return;
  e.stopPropagation();
  const b = balda(e.currentTarget.dataset.id);
  const tirador = e.target.classList.contains('tirador')
    ? (e.target.classList.contains('izq') ? 'x0' : 'x1') : null;

  const mover = (ev) => {
    if (tirador) {
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.x) / rect.w));
      if (tirador === 'x0') b.x0 = Math.min(x, b.x1 - 0.02);
      else b.x1 = Math.max(x, b.x0 + 0.02);
    } else {
      b.y = Math.min(0.995, Math.max(0.02, (ev.clientY - rect.y) / rect.h));
    }
    pintar();
  };
  const soltar = () => {
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', soltar);
    guardar(); pintar();
  };
  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', soltar);
}

elBaldas.addEventListener('pointerdown', (e) => {
  if (!ajustandoBaldas || e.target !== elBaldas) return;
  const y = Math.min(0.995, Math.max(0.02, (e.clientY - rect.y) / rect.h));
  st.baldas.push({ id: 'b' + uid(), y, x0: 0.02, x1: 0.98 });
  guardar(); pintar();
});

/* --- Color de la pared -------------------------------------------------

   El fondo viene en dos capas: la pared, que existe en varios colores, y las
   estanterías sueltas encima. Cambiar de color es cambiar de imagen, sin
   filtros ni recoloreados: antes había que sustituir colores píxel a píxel y
   eso partía el degradado de las sombras y apagaba el conjunto.

   Las botellas ya vienen con fondo transparente, así que solo reciben una
   atenuación suave para que acompañen al tono de la pared. No se les toca el
   brillo: ahí estaba lo de que "los colores se ven demasiado oscuros". */

let paredes = [];
let capaEstanterias = '';

const paredActual = () => paredes.find((p) => p.id === st.color.fondo) || paredes[0] || null;

function colorPorDefecto() {
  return { fondo: 'amarillo.png', hex: null, botellas: true };
}

/** El color que manda ahora mismo: el de la pared elegida, o el tuyo. */
const colorEfectivo = () => st.color.hex || (paredActual() ? paredActual().color : '#ffe58b');

function rgbAHsl([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const mx = Math.max(R, G, B);
  const mn = Math.min(R, G, B);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === R) h = ((G - B) / d) % 6;
    else if (mx === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0, l };
}

function hexAHsl(hex) {
  const n = hex.replace('#', '');
  const c = n.length === 3 ? n.split('').map((x) => x + x).join('') : n;
  return rgbAHsl([0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)));
}

const TONO_AMARILLO = 45;   // la pared original, de la que se mide el desvío

/* --- Colores a medida --------------------------------------------------

   Además de las siete paredes hay un selector libre. La primera versión buscaba
   el filtro CSS que más se acercara al color pedido, probando los 360 giros de
   tono: se quedaba corta con los colores vivos, porque `saturate` no puede
   llevar un amarillo claro hasta un azul intenso (un #0069ac se iba a 97 de
   distancia sobre 441).

   Esto hace otra cosa: pone una capa del color elegido con mezcla `color`, que
   toma el tono y la saturación de arriba y la luminosidad de abajo, y ajusta el
   brillo de la pared para que esa luminosidad sea la del color pedido. El
   resultado cae a 1 de distancia, y de paso conserva el ladrillo, porque la
   textura vive precisamente en esas diferencias de luminosidad. */

const PARED_BASE = 'amarillo.png';

/** Luminosidad tal como la entiende la mezcla `color` de CSS. */
function luminosidad(hex) {
  const n = hex.replace('#', '');
  const c = n.length === 3 ? n.split('').map((x) => x + x).join('') : n;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

/**
 * Atenuación de las botellas: un empujón del 18 % del tono hacia el de la
 * pared y una pizca menos de saturación. Sin tocar el brillo, para que nada
 * se oscurezca.
 */
function filtroBotellas() {
  if (!st.color.botellas) return 'none';

  const c = hexAHsl(colorEfectivo());
  let giro = ((c.h - TONO_AMARILLO) % 360 + 540) % 360 - 180;
  giro *= 0.18;
  if (Math.abs(giro) < 1) return 'saturate(0.97)';
  return `hue-rotate(${giro.toFixed(1)}deg) saturate(0.95)`;
}

function aplicarColor() {
  const aMedida = Boolean(st.color.hex);
  if (aMedida) st.color.fondo = PARED_BASE;

  const p = paredActual();
  if (!p) return;
  st.color.fondo = p.id;

  if (elPared.getAttribute('src') !== p.src) elPared.src = p.src;
  document.body.style.background = colorEfectivo();

  const raiz = document.documentElement.style;

  if (aMedida) {
    // El brillo iguala la luminosidad de la pared a la del color pedido; la
    // capa de mezcla se encarga del tono. Juntos aciertan el color exacto.
    const k = Math.min(2, Math.max(0.05, luminosidad(st.color.hex) / luminosidad(p.color)));
    raiz.setProperty('--tinte-pared', `brightness(${k.toFixed(3)})`);
    elTinta.style.background = st.color.hex;
    elTinta.hidden = false;
  } else {
    raiz.setProperty('--tinte-pared', 'none');
    elTinta.hidden = true;
  }

  // Las estanterías y las botellas acompañan con una atenuación suave.
  const suave = filtroBotellas();
  raiz.setProperty('--tinte-botellas', suave);
  raiz.setProperty('--tinte-madera', suave);
}

function pintarPaleta() {
  const aMedida = Boolean(st.color.hex);
  $('#paleta-lista').innerHTML = paredes.map((p) => `
    <button class="muestra" data-fondo="${escHtml(p.id)}" title="${escHtml(p.nombre)}"
            style="background:${p.color}"
            aria-pressed="${!aMedida && p.id === st.color.fondo}"></button>`).join('');
  $('#paleta-color').value = colorEfectivo();
  $('#paleta-color').parentElement.setAttribute('aria-pressed', String(aMedida));
  $('#paleta-botellas').checked = st.color.botellas;
}

function cambiarColor(cambios) {
  Object.assign(st.color, cambios);
  aplicarColor();
  pintarPaleta();
  guardar();
}

$('#paleta-lista').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fondo]');
  if (b) cambiarColor({ fondo: b.dataset.fondo, hex: null });
});
$('#paleta-color').addEventListener('input', (e) => cambiarColor({ hex: e.target.value }));
$('#paleta-botellas').addEventListener('change', (e) => cambiarColor({ botellas: e.target.checked }));

// --- Cursor prestado ----------------------------------------------------

/**
 * En la capa 'detrás de los iconos' la ventana es el fondo de pantalla y :hover
 * no llega a dispararse. El proceso principal nos pasa dónde está el cursor y
 * aquí encendemos a mano el cartelito del objeto que tenga debajo.
 */
function cursorEn(p) {
  if (!p || modo === 'editar') { resaltar(null); return; }
  if (moverPrestado(p)) { resaltar(null); return; }
  resaltar(objetoEn(p));
}

function resaltar(id) {
  if (resaltada === id) return;
  if (resaltada) nodos.get(resaltada)?.classList.remove('encima');
  resaltada = id;
  if (id) nodos.get(id)?.classList.add('encima');
}

// --- Menú del botón derecho ---------------------------------------------

const elMenu = $('#menu');

/** Si hace falta escribir o arrastrar, primero desbloqueamos la estantería. */
async function asegurarEdicion() {
  if (modo !== 'editar') await window.estanteria.cambiarModo('editar');
}

/** Crea algo en el escritorio y lo deja colocado y seleccionado. */
async function crearYColocar(promesa, pedirNombre = false) {
  const creado = await promesa;
  if (!creado) return;
  await sincronizar(await window.estanteria.carpetas());
  seleccionar(creado.ruta);
  if (pedirNombre) {
    const nombre = await pedirTexto('Nombre', creado.nombre);
    if (nombre && nombre !== creado.nombre) await renombrar(creado.ruta, nombre);
  }
  guardar();
}

const nuevaCarpeta = () => crearYColocar(window.estanteria.crearCarpeta('Nueva carpeta'), true);
const nuevoAcceso = () => crearYColocar(window.estanteria.crearAcceso(), true);
const nuevoDocumento = () => crearYColocar(window.estanteria.crearDocumento(), true);

async function copiarAlPortapapeles(id, modoCopia) {
  await window.estanteria.copiar([id], modoCopia);
}

async function pegarAqui() {
  const creadas = await window.estanteria.pegar();
  if (!creadas || !creadas.length) return;
  await sincronizar(await window.estanteria.carpetas());
  seleccionar(creadas[creadas.length - 1]);
}

/** Aplica una altura a todas las botellas colocadas. */
function tamanoTodas(f) {
  for (const o of objetos()) {
    const s = o.tipo === 'botella' ? sitio(o.id) : null;
    if (s && s.balda) s.alto = Math.min(altoMaximo(s.balda), f);
  }
  guardar(); pintar();
}

async function menuDeFondo() {
  const hayQuePegar = await window.estanteria.hayQuePegar();
  return [
    { txt: 'Ver', sub: [
      { txt: 'Botellas grandes', f: () => tamanoTodas(0.22) },
      { txt: 'Botellas medianas', f: () => tamanoTodas(0.16) },
      { txt: 'Botellas pequeñas', f: () => tamanoTodas(0.11) },
      '-',
      { txt: 'Color del fondo…', f: async () => {
        await asegurarEdicion();
        $('#paleta').hidden = false;
        pintarPaleta();
      } },
      { txt: 'Ajustar baldas', f: async () => { await asegurarEdicion(); alternarBaldas(); } },
    ] },
    { txt: 'Ordenar por', sub: [
      { txt: 'Nombre', f: () => ordenar('nombre') },
      { txt: 'Altura', f: () => ordenar('altura') },
      { txt: 'Repartir por baldas',
        f: () => repartir(objetos().filter((o) => o.tipo === 'botella' && sitio(o.id)).map((o) => o.id)) },
    ] },
    { txt: 'Actualizar', f: async () => { await sincronizar(await window.estanteria.carpetas()); refrescarPapelera(); } },
    '-',
    { txt: 'Pegar', apagado: !hayQuePegar, f: pegarAqui },
    { txt: 'Nuevo', sub: [
      { txt: 'Carpeta', f: async () => { await asegurarEdicion(); nuevaCarpeta(); } },
      { txt: 'Acceso directo…', f: async () => { await asegurarEdicion(); nuevoAcceso(); } },
      { txt: 'Documento de texto', f: async () => { await asegurarEdicion(); nuevoDocumento(); } },
      '-',
      { txt: 'Póster…', f: async () => { await asegurarEdicion(); nuevoPoster(); } },
    ] },
    '-',
    { txt: 'Distribución', sub: Object.entries(st.escenas).map(([eid, e]) => ({
      txt: e.nombre, marca: eid === st.escena, f: () => cambiarEscena(eid),
    })) },
    { txt: modo === 'editar' ? 'Bloquear estantería' : 'Ordenar estantería',
      f: () => window.estanteria.cambiarModo(modo === 'editar' ? 'fondo' : 'editar') },
    '-',
    { txt: 'Configuración de pantalla', f: () => window.estanteria.sistema('pantalla') },
    { txt: 'Personalizar', f: () => window.estanteria.sistema('personalizar') },
    { txt: 'Abrir en Terminal', f: () => window.estanteria.sistema('terminal') },
    { txt: 'Abrir el escritorio', f: () => window.estanteria.abrirRuta(escritorio) },
  ];
}

function menuDePapelera() {
  return [
    { txt: 'Abrir la papelera', f: () => window.estanteria.abrirPapelera() },
    { txt: 'Vaciar la papelera', peligro: true, apagado: !papeleraLlena, f: async () => {
      const ok = await confirmar('¿Vaciar la papelera de reciclaje?',
        'Se borra definitivamente todo lo que tenga dentro.');
      if (ok) { await window.estanteria.vaciarPapelera(); refrescarPapelera(); }
    } },
    '-',
    { txt: 'Capas', apagado: !sitio(PAPELERA), sub: [
      { txt: 'Traer al frente', f: () => traerAlFrente(PAPELERA) },
      { txt: 'Enviar al fondo', f: () => enviarAlFondo(PAPELERA) },
    ] },
    sitio(PAPELERA)
      ? { txt: 'Quitar de esta distribución', f: () => { colocar(PAPELERA, null); guardar(); pintar(); } }
      : { txt: 'Poner en la estantería', f: () => { ponerEnLaEstanteria(PAPELERA); guardar(); pintar(); } },
  ];
}

function menuDeBotella(id, o) {
  if (id === PAPELERA) return menuDePapelera();
  return [
    { txt: 'Abrir', f: () => window.estanteria.abrirRuta(o.ruta) },
    '-',
    { txt: 'Copiar', f: () => copiarAlPortapapeles(id, 'copiar') },
    { txt: 'Cortar', f: () => copiarAlPortapapeles(id, 'cortar') },
    { txt: 'Renombrar…', f: async () => { await asegurarEdicion(); renombrarInteractivo(id); } },
    { txt: 'Cambiar gráfico…', f: async () => { await asegurarEdicion(); editar(id); } },
    '-',
    { txt: 'Capas', apagado: !sitio(id), sub: [
      { txt: 'Traer al frente', f: () => traerAlFrente(id) },
      { txt: 'Traer adelante', f: () => mover1Capa(id, 1) },
      { txt: 'Enviar atrás', f: () => mover1Capa(id, -1) },
      { txt: 'Enviar al fondo', f: () => enviarAlFondo(id) },
    ] },
    sitio(id)
      ? { txt: 'Quitar de esta distribución', f: () => { colocar(id, null); guardar(); pintar(); } }
      : { txt: 'Poner en la estantería', f: () => { ponerEnLaEstanteria(id); guardar(); pintar(); } },
    '-',
    { txt: 'Enviar a la papelera', peligro: true, f: async () => { await asegurarEdicion(); tirarCarpeta(id); } },
  ];
}

function menuDePoster(id) {
  return [
    { txt: 'Editar póster…', f: async () => { await asegurarEdicion(); editar(id); } },
    sitio(id)
      ? { txt: 'Quitar de esta distribución', f: () => { colocar(id, null); guardar(); pintar(); } }
      : { txt: 'Poner en la pared', f: () => { colocar(id, { x: 0.5, y: 0.25, w: ANCHO_POSTER, rot: 0 }); guardar(); pintar(); } },
    '-',
    { txt: 'Eliminar póster', peligro: true, f: () => borrarPoster(id) },
  ];
}

/** Pinta una lista de opciones dentro de un panel del menú. */
function panelMenu(opciones, nivel) {
  const panel = document.createElement('div');
  panel.className = 'panel-menu';
  panel.dataset.nivel = String(nivel);

  for (const op of opciones) {
    if (op === '-') { panel.appendChild(document.createElement('hr')); continue; }

    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = op.txt;
    if (op.peligro) b.className = 'peligro';
    if (op.marca) b.dataset.marca = '1';
    if (op.apagado) b.disabled = true;

    if (op.sub) {
      b.dataset.sub = '1';
      const hijo = panelMenu(op.sub, nivel + 1);
      hijo.hidden = true;
      b.addEventListener('pointerenter', () => {
        for (const otro of panel.querySelectorAll(':scope > .panel-menu')) otro.hidden = true;
        hijo.hidden = false;
        const c = b.getBoundingClientRect();
        hijo.style.left = `${c.width - 4}px`;
        hijo.style.top = `${b.offsetTop - 6}px`;
        const caja = hijo.getBoundingClientRect();
        if (caja.right > window.innerWidth - 8) hijo.style.left = `${-caja.width + 4}px`;
        if (caja.bottom > window.innerHeight - 8) {
          hijo.style.top = `${b.offsetTop - caja.height + c.height + 6}px`;
        }
      });
      panel.appendChild(b);
      panel.appendChild(hijo);
    } else {
      b.addEventListener('pointerenter', () => {
        for (const otro of panel.querySelectorAll(':scope > .panel-menu')) otro.hidden = true;
      });
      if (!op.apagado) b.addEventListener('click', () => { cerrarMenu(); op.f(); });
      panel.appendChild(b);
    }
  }
  return panel;
}

async function abrirMenu(e, id) {
  const o = id ? objeto(id) : null;
  const opciones = !o ? await menuDeFondo()
    : (esPoster(id) ? menuDePoster(id) : menuDeBotella(id, o));

  elMenu.replaceChildren(panelMenu(opciones, 0));
  elMenu.hidden = false;
  elMenu.style.left = '0px';
  elMenu.style.top = '0px';

  const c = elMenu.getBoundingClientRect();
  elMenu.style.left = `${Math.max(4, Math.min(e.clientX, window.innerWidth - c.width - 8))}px`;
  elMenu.style.top = `${Math.max(4, Math.min(e.clientY, window.innerHeight - c.height - 8))}px`;
}

function cerrarMenu() { elMenu.hidden = true; }

/* --- Menú del sistema --------------------------------------------------
   En la capa de fondo de pantalla nuestra ventana no recibe clics, así que un
   menú dibujado dentro no se podría pulsar. Mandamos las mismas opciones al
   proceso principal para que las saque como menú nativo de Windows. */

const accionesMenu = new Map();

function aPlantilla(opciones) {
  return opciones.map((op) => {
    if (op === '-') return { sep: true };
    const id = uid();
    if (op.sub) return { id, txt: op.txt, apagado: op.apagado, sub: aPlantilla(op.sub) };
    accionesMenu.set(id, op.f);
    return { id, txt: op.txt, apagado: op.apagado, marca: op.marca };
  });
}

async function menuDelSistema(punto, id) {
  const o = id ? objeto(id) : null;
  const opciones = !o ? await menuDeFondo()
    : (esPoster(id) ? menuDePoster(id) : menuDeBotella(id, o));

  accionesMenu.clear();
  await window.estanteria.menuNativo(aPlantilla(opciones), punto);
}

window.estanteria.alElegirMenu((id) => {
  const f = accionesMenu.get(id);
  if (f) f();
});

/* --- Arrastre con el ratón prestado ------------------------------------
   Sin eventos de ratón no hay pointerdown ni pointermove, así que el arrastre
   se reconstruye con lo que llega del proceso principal: pulsar, las
   posiciones del cursor y soltar. Solo para botellas: un póster movido a
   ciegas es fácil de perder, y para eso está el modo edición. */

let arrastreP = null;
const UMBRAL_PX = 5;

function clicPrestado(c) {
  if (modo === 'editar' || Editor.abierto()) return;

  if (c.boton === 'der' && c.tipo === 'abajo') {
    const id = objetoEn(c);
    if (id) seleccionar(id);
    menuDelSistema({ x: c.x, y: c.y }, id);
    return;
  }
  if (c.boton !== 'izq') return;

  if (c.tipo === 'arriba') { soltarPrestado(c); return; }

  const id = objetoEn(c);
  if (c.doble && id) { alAbrir(id); return; }
  empezarArrastreFondo(id, c);
}

/**
 * Prepara el arrastre de una botella sin estar en modo edición. No se mueve
 * nada hasta pasar de UMBRAL_PX, así que un clic o un doble clic siguen
 * abriendo la carpeta como siempre.
 */
function empezarArrastreFondo(id, c) {
  if (!id || esPoster(id)) return;

  const s = sitio(id);
  if (!s || !s.balda) return;

  const el = nodos.get(id);
  if (!el) return;
  const caja = el.getBoundingClientRect();
  arrastreP = {
    id,
    el,
    movida: false,
    dx: c.x - (caja.left + caja.width / 2),
    dy: c.y - caja.bottom,
    alto: caja.height,
    inicio: { x: c.x, y: c.y },
  };
}

/**
 * Arrastre con el ratón de verdad, fuera del modo edición. Pasa en las capas
 * que sí reciben ratón ('Sobre los iconos', 'Suelta', 'Como ventana'); en
 * 'Detrás de los iconos' el mismo arrastre llega por clicPrestado.
 */
function arrastrarEnFondo(e) {
  const el = e.currentTarget;
  const punto = (ev) => ({ x: ev.clientX, y: ev.clientY });
  empezarArrastreFondo(el.dataset.id, punto(e));
  if (!arrastreP) return;

  try { el.setPointerCapture(e.pointerId); } catch (_) { /* nada */ }
  const mover = (ev) => moverPrestado(punto(ev));
  const soltar = (ev) => {
    el.removeEventListener('pointermove', mover);
    el.removeEventListener('pointerup', soltar);
    el.removeEventListener('pointercancel', soltar);
    try { el.releasePointerCapture(ev.pointerId); } catch (_) { /* nada */ }
    soltarPrestado(punto(ev));
  };
  el.addEventListener('pointermove', mover);
  el.addEventListener('pointerup', soltar);
  el.addEventListener('pointercancel', soltar);
}

/** Llega desde el seguimiento del cursor mientras el botón sigue pulsado. */
function moverPrestado(p) {
  const a = arrastreP;
  if (!a) return false;

  if (!a.movida) {
    if (Math.abs(p.x - a.inicio.x) < UMBRAL_PX && Math.abs(p.y - a.inicio.y) < UMBRAL_PX) return true;
    a.movida = true;
    resaltar(null);
    a.el.classList.add('arrastrando');
    a.el.style.height = `${a.alto}px`;
    seleccionar(a.id);
  }

  a.el.style.left = `${p.x - a.dx - rect.x}px`;
  a.el.style.bottom = `${rect.h - (p.y - a.dy - rect.y)}px`;

  const pap = nodos.get(PAPELERA);
  a.enPapelera = false;
  if (pap && a.id !== PAPELERA && sitio(PAPELERA)) {
    const r = pap.getBoundingClientRect();
    a.enPapelera = p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    pap.classList.toggle('destino', a.enPapelera);
  }

  const destino = a.enPapelera ? null : baldaCercaDe(p.x - a.dx, p.y - a.dy);
  for (const l of elBaldas.children) l.classList.toggle('destino', l.dataset.id === destino);
  return true;
}

function soltarPrestado(c) {
  const a = arrastreP;
  arrastreP = null;
  if (!a) return;

  a.el.classList.remove('arrastrando');
  a.el.style.height = '';
  nodos.get(PAPELERA)?.classList.remove('destino');
  for (const l of elBaldas.children) l.classList.remove('destino');

  if (!a.movida) { pintar(); return; }

  if (a.enPapelera) { pintar(); tirarCarpeta(a.id); return; }

  const bal = balda(baldaCercaDe(c.x - a.dx, c.y - a.dy));
  if (!bal) { pintar(); return; }
  const w = anchoFraccion(a.el);
  colocar(a.id, {
    balda: bal.id,
    x: Math.min(bal.x1 - w / 2, Math.max(bal.x0 + w / 2, (c.x - a.dx - rect.x) / rect.w)),
    alto: Math.min(a.alto / rect.h, altoMaximo(bal.id)),
    z: sitio(a.id)?.z ?? 0,
  });
  guardar();
  pintar();
}

/**
 * Tramo más cercano a un punto de la ventana, en píxeles.
 *
 * No basta con quedarse con los tramos que cubren esa x: el suelo va de lado a
 * lado, así que soltar una botella en el hueco central de la estantería la
 * mandaba abajo aunque la hubieras soltado arriba del todo. Se mide la
 * distancia vertical más lo que te hayas salido del tramo por los lados.
 */
function baldaCercaDe(px, py) {
  const x = (px - rect.x) / rect.w;
  const y = (py - rect.y) / rect.h;

  let mejor = st.baldas[0];
  if (!mejor) return null;
  let mejorD = Infinity;
  for (const b of st.baldas) {
    const fuera = Math.max(b.x0 - x, x - b.x1, 0);
    const d = Math.abs(b.y - y) + fuera * 2;
    if (d < mejorD) { mejor = b; mejorD = d; }
  }
  return mejor.id;
}

/** Qué hay debajo de un punto de la ventana. */
function objetoEn(p) {
  let encontrado = null;
  for (const [id, el] of nodos) {
    if (el.parentElement === elCajonLista) continue;
    const c = el.getBoundingClientRect();
    if (p.x < c.left || p.x > c.right || p.y < c.top || p.y > c.bottom) continue;
    if (!encontrado || Number(el.style.zIndex || 0) >= Number(nodos.get(encontrado).style.zIndex || 0)) {
      encontrado = id;
    }
  }
  return encontrado;
}

window.addEventListener('contextmenu', (e) => {
  if (Editor.abierto() || !$('#pregunta').hidden || ajustandoBaldas) return;
  e.preventDefault();
  const nodo = e.target.closest('.botella, .poster');
  if (nodo) seleccionar(nodo.dataset.id);
  abrirMenu(e, nodo ? nodo.dataset.id : null);
});

window.estanteria.alHacerClic(clicPrestado);
window.addEventListener('pointerdown', (e) => { if (!e.target.closest('#menu')) cerrarMenu(); }, true);
window.addEventListener('blur', cerrarMenu);

// --- Barra --------------------------------------------------------------

const PISTA = 'Clic para seleccionar · arrastra para mover · tira del asa o la rueda para el tamaño · botón derecho para el menú';

$('#escenas').addEventListener('change', (e) => cambiarEscena(e.target.value));

document.addEventListener('click', (e) => {
  const accion = e.target.dataset.accion;
  if (!accion) return;

  if (accion === 'nueva') nuevaCarpeta();
  if (accion === 'poster') nuevoPoster();
  if (accion === 'ordenar-nombre') ordenar('nombre');
  if (accion === 'ordenar-altura') ordenar('altura');
  if (accion === 'repartir') {
    repartir(objetos().filter((o) => o.tipo === 'botella' && sitio(o.id)).map((o) => o.id));
  }
  if (accion === 'bloquear') window.estanteria.cambiarModo('fondo');

  if (accion === 'escena-nueva') escenaNuevaInteractiva();
  if (accion === 'escena-renombrar') escenaRenombrar();
  if (accion === 'escena-borrar') escenaBorrar();

  if (accion === 'sel-editar' && seleccion) editar(seleccion);
  if (accion === 'sel-guardar' && seleccion) { colocar(seleccion, null); guardar(); pintar(); }
  if (accion === 'sel-borrar' && seleccion) eliminar(seleccion);
  if (accion === 'sel-adelante' && seleccion) mover1Capa(seleccion, 1);
  if (accion === 'sel-atras' && seleccion) mover1Capa(seleccion, -1);

  if (accion === 'baldas') alternarBaldas();

  if (accion === 'color') {
    const p = $('#paleta');
    p.hidden = !p.hidden;
    if (!p.hidden) pintarPaleta();
    $('#btn-color').setAttribute('aria-pressed', String(!p.hidden));
  }
  if (accion === 'color-cerrar') {
    $('#paleta').hidden = true;
    $('#btn-color').setAttribute('aria-pressed', 'false');
  }
});

function alternarBaldas() {
  ajustandoBaldas = !ajustandoBaldas;
  document.body.dataset.baldas = ajustandoBaldas ? '1' : '0';
  $('#btn-baldas').setAttribute('aria-pressed', String(ajustandoBaldas));
  $('#pista').textContent = ajustandoBaldas
    ? 'Arrastra cada línea hasta el borde de su balda y los tiradores para marcar dónde empieza y acaba. Clic en el fondo añade un tramo, doble clic lo quita.'
    : PISTA;
  pintarSeleccion();
}

$('#sel-tam').addEventListener('input', (e) => {
  cambiarTamano(Number(e.target.value) / 100);
  $('#sel-num').textContent = `${Math.round(e.target.value)}%`;
});
$('#sel-grosor').addEventListener('input', (e) => {
  if (!seleccion) return;
  const o = objeto(seleccion);
  if (!o || o.tipo !== 'botella' || seleccion === PAPELERA) return;
  const g = st.graficos[seleccion] || (st.graficos[seleccion] = { grafico: o.grafico });
  g.grafico = { ...g.grafico, grosor: Number(e.target.value) / 100 };
  refrescarNodo(seleccion);
  pintar(); guardar();
});

$('#sel-giro').addEventListener('input', (e) => {
  const s = sitio(seleccion);
  if (!s) return;
  s.rot = Number(e.target.value);
  pintar(); guardar();
});

elEscenario.addEventListener('pointerdown', (e) => {
  if (modo !== 'editar') return;
  if (e.target === elEscenario || e.target === elPared) seleccionar(null);
});

// --- Arranque -----------------------------------------------------------

function aplicarModo(nuevo) {
  modo = nuevo;
  document.body.dataset.modo = nuevo;
  if (arrastreP) {   // por si cambias de modo con una botella en la mano
    arrastreP.el.classList.remove('arrastrando');
    arrastreP.el.style.height = '';
    arrastreP = null;
    pintar();
  }
  if (nuevo !== 'editar') {
    $('#paleta').hidden = true;
    if (ajustandoBaldas) { ajustandoBaldas = false; document.body.dataset.baldas = '0'; }
    Editor.cerrar();
    seleccionar(null);
  } else {
    resaltar(null);
  }
  pintarSeleccion();
}

function migrar(estado) {
  if (!estado) return estadoInicial();
  if (estado.version === 5) return estado;

  /* El dibujo del fondo cambió por completo: las baldas de antes ya no
     coinciden con la madera nueva, así que se rehacen. Lo tuyo —qué carpetas
     hay, con qué dibujo y en qué distribución— se conserva; lo que se pierde
     es la posición exacta dentro de la balda, que se recoloca sola. */
  if (estado.version === 4) {
    const viejas = new Map((estado.baldas || []).map((b) => [b.id, b]));
    const nuevas = JSON.parse(JSON.stringify(BALDAS_POR_DEFECTO));

    // Cada balda vieja se empareja con la nueva más parecida en sitio.
    const equivale = {};
    for (const [id, b] of viejas) {
      let mejor = nuevas[0];
      let d0 = Infinity;
      for (const n of nuevas) {
        const d = Math.abs(n.y - b.y) + Math.abs(n.x0 - b.x0) * 0.5;
        if (d < d0) { d0 = d; mejor = n; }
      }
      equivale[id] = mejor.id;
    }

    for (const e of Object.values(estado.escenas || {})) {
      for (const d of Object.values(e.botellas || {})) {
        if (d.balda && equivale[d.balda]) d.balda = equivale[d.balda];
      }
    }

    return { ...estado, version: 5, baldas: nuevas, color: colorPorDefecto() };
  }

  // v3 y anteriores guardaban botellas creadas a mano. Las que estaban
  // vinculadas a una carpeta se convierten en esa carpeta del escritorio;
  // las que no apuntaban a ninguna se pierden, porque ya no existen como tal.
  if (estado.version === 3) {
    const graficos = {};
    const mapa = {};
    for (const [id, c] of Object.entries(estado.carpetas || {})) {
      if (!c.ruta) continue;
      graficos[c.ruta] = { grafico: c.grafico };
      mapa[id] = c.ruta;
    }
    const escenas = {};
    for (const [eid, e] of Object.entries(estado.escenas || {})) {
      const botellas = {};
      for (const [id, d] of Object.entries(e.botellas || {})) {
        if (mapa[id]) botellas[mapa[id]] = d;
      }
      escenas[eid] = { nombre: e.nombre, botellas, carteles: e.carteles || {} };
    }
    return migrar({
      version: 4,
      ajuste: estado.ajuste || 'cover',
      baldas: estado.baldas,
      graficos,
      posters: estado.posters || {},
      escenas: Object.keys(escenas).length ? escenas : { e1: escenaNueva('Principal') },
      escena: escenas[estado.escena] ? estado.escena : Object.keys(escenas)[0] || 'e1',
    });
  }

  if (estado.version === 2) {
    // La disposición suelta pasa a ser la primera distribución.
    return migrar({
      version: 3,
      ajuste: estado.ajuste || 'cover',
      baldas: estado.baldas,
      carpetas: estado.carpetas || {},
      posters: {},
      escenas: { e1: { nombre: 'Principal', botellas: estado.disposicion || {}, carteles: {} } },
      escena: 'e1',
    });
  }
  return estadoInicial();
}

async function iniciar() {
  const datos = await window.estanteria.cargar();
  anclaje = datos.anclaje || 'encima';
  escritorio = datos.escritorio || '';
  Botellas.usarPack(datos.pack || [], datos.libros || []);
  paredes = datos.fondos || [];
  capaEstanterias = datos.estanterias || '';
  imagenes = datos.imagenes || {};
  carpetas = datos.carpetas || [];
  papeleraLlena = Boolean(datos.papelera);
  st = migrar(datos.estado);
  st.graficos = st.graficos || {};
  st.color = { ...colorPorDefecto(), ...(st.color || {}) };
  if (!paredes.length) {
    elAviso.hidden = false;
    elAviso.innerHTML = '<p>Faltan las imágenes del fondo.</p>'
      + '<p>Deben estar en <code>assets/fondos/</code> y <code>assets/estanterias.png</code>.</p>';
    return;
  }
  aplicarColor();
  st.baldas = st.baldas?.length ? st.baldas : JSON.parse(JSON.stringify(BALDAS_POR_DEFECTO));
  aplicarModo(datos.modo || 'fondo');
  $('#pista').textContent = PISTA;

  elPared.src = paredActual().src;
  if (capaEstanterias) elEstanterias.src = capaEstanterias;
  await elPared.decode().catch(() => {});
  calcularRect();
  pintarEscenas();
  pintar();
  await Promise.all([...nodos.values()].map(esperarDibujo));

  // La papelera va primero, al final del último tramo: es donde se espera.
  if (!sitio(PAPELERA)) {
    const suelo = baldasOrdenadas().at(-1);
    const w = anchoFraccion(nodos.get(PAPELERA));
    colocar(PAPELERA, {
      balda: suelo.id,
      x: suelo.x1 - w / 2 - 0.01,
      alto: Math.min(ALTO_POR_DEFECTO, altoMaximo(suelo.id)),
      z: 0,
    });
  }

  // Las carpetas que aún no tienen sitio entran solas.
  for (const o of objetos()) {
    if (o.tipo === 'botella' && !conocido(o.id)) ponerEnLaEstanteria(o.id);
  }
  pintar();
  guardar();

  if (!carpetas.length) {
    elAviso.hidden = false;
    elAviso.innerHTML = `<p>No hay ninguna carpeta en tu escritorio.</p>
      <p>Clic derecho sobre la estantería → <b>Nueva carpeta</b>.</p>`;
  }
}

elAviso.addEventListener('click', () => { elAviso.hidden = true; });

window.addEventListener('resize', () => { if (st) { calcularRect(); pintar(); } });
window.estanteria.alCambiarModo(aplicarModo);
window.estanteria.alRecargar(() => location.reload());
window.estanteria.alNueva(() => nuevaCarpeta());
window.estanteria.alMoverCursor(cursorEn);
window.estanteria.alCambiarEscena((id) => cambiarEscena(id));
window.estanteria.alCambiarCarpetas((lista) => { if (st) sincronizar(lista); });
window.estanteria.alCambiarPapelera((llena) => {
  if (!st || llena === papeleraLlena) return;
  papeleraLlena = llena;
  refrescarNodo(PAPELERA);
  pintar();
});

window.addEventListener('keydown', (e) => {
  if (Editor.abierto() || !$('#pregunta').hidden) return;
  if (e.key === 'Escape' && modo === 'editar') {
    if (seleccion) seleccionar(null);
    else window.estanteria.cambiarModo('fondo');
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'c' && seleccion && !esPoster(seleccion)) { copiarAlPortapapeles(seleccion, 'copiar'); e.preventDefault(); }
    if (e.key === 'x' && seleccion && !esPoster(seleccion)) { copiarAlPortapapeles(seleccion, 'cortar'); e.preventDefault(); }
    if (e.key === 'v') { pegarAqui(); e.preventDefault(); }
    return;
  }

  if (modo !== 'editar' || !seleccion) return;

  const s = sitio(seleccion);
  if (!s) return;
  const poster = esPoster(seleccion);
  const paso = e.shiftKey ? 0.02 : 0.004;

  if (e.key === '+' || e.key === '=') { cambiarTamano((poster ? s.w : s.alto) + paso); e.preventDefault(); }
  if (e.key === '-') { cambiarTamano((poster ? s.w : s.alto) - paso); e.preventDefault(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { colocar(seleccion, null); guardar(); pintar(); e.preventDefault(); }
  if (e.key === 'F2' && !poster) { renombrarInteractivo(seleccion); e.preventDefault(); }
  if (e.key === 'PageUp' && !poster) { mover1Capa(seleccion, 1); e.preventDefault(); }
  if (e.key === 'PageDown' && !poster) { mover1Capa(seleccion, -1); e.preventDefault(); }

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    s.x += (e.key === 'ArrowLeft' ? -1 : 1) * paso;
    pintar(); guardar(); e.preventDefault();
  }
  if (poster && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    s.y += (e.key === 'ArrowUp' ? -1 : 1) * paso;
    pintar(); guardar(); e.preventDefault();
  }
});

iniciar();

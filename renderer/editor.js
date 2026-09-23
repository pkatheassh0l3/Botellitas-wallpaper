'use strict';

/* ------------------------------------------------------------------
   Editor de botellas.

   Se abre al crear una botella nueva y también después, para retocarla.
   Trabaja siempre sobre una copia: hasta que no pulsas Guardar no se
   toca la estantería.
   ------------------------------------------------------------------ */

const Editor = (() => {

  const el = {};
  let ctx = null;
  let borrador = null;
  let seleccion = null;     // capa seleccionada
  let arrastre = null;
  let filtro = '';
  let soloLisas = true;
  let montado = false;

  const uid = () => Math.random().toString(36).slice(2, 10);
  const limpioId = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '');
  const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // --- Montaje ----------------------------------------------------------

  function montar() {
    const raiz = document.createElement('div');
    raiz.id = 'editor';
    raiz.hidden = true;
    raiz.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-label="Editor">
        <div class="lienzo">
          <div class="vista" id="ed-vista"></div>
          <p class="ayuda" id="ed-ayuda"></p>
        </div>

        <div class="controles">
          <label class="campo">
            <span>Nombre</span>
            <input id="ed-nombre" type="text" maxlength="60" placeholder="Sin nombre">
            <small class="solo-botella">Cambiarlo renombra la carpeta del escritorio.</small>
          </label>

          <div class="campo solo-poster">
            <span>Carpeta que abre</span>
            <div class="fila">
              <button id="ed-ruta" class="secundario">Elegir carpeta…</button>
              <button id="ed-quitar-ruta" class="icono" title="Desvincular" hidden>✕</button>
            </div>
            <small id="ed-ruta-txt">Sin vincular</small>
          </div>

          <div class="campo solo-poster">
            <span>Lámina</span>
            <div class="fila">
              <button id="ed-imagen" class="secundario">Cambiar imagen…</button>
            </div>
          </div>

          <div class="campo solo-poster">
            <span>Marco</span>
            <div class="marcos" id="ed-marcos"></div>
          </div>

          <div class="campo solo-botella">
            <span>Dibujo</span>
            <div class="fila familias">
              <button id="ed-fam-botella" data-familia="botella" class="secundario">Botella</button>
              <button id="ed-fam-libro" data-familia="libro" class="secundario">Libro</button>
            </div>
            <div class="fila">
              <input id="ed-buscar" type="text" placeholder="Buscar…">
              <button id="ed-lisas" class="secundario" aria-pressed="true">Solo lisas</button>
            </div>
            <div class="rejilla" id="ed-pack"></div>
          </div>

          <label class="campo solo-libro">
            <span>Texto del lomo</span>
            <input id="ed-lomo" type="text" maxlength="40" placeholder="El nombre de la carpeta">
            <small>Se escribe en vertical, con el color del propio libro.</small>
          </label>

          <div class="campo solo-botella">
            <span>Imágenes encima</span>
            <div class="fila">
              <button id="ed-anadir" class="secundario">Añadir imagen…</button>
            </div>
            <div class="capas" id="ed-capas"></div>
          </div>

          <div class="campo capa-ctl solo-botella" id="ed-capa-ctl" hidden>
            <span>Imagen seleccionada</span>
            <label class="mini">Tamaño <input id="ed-cap-w" type="range" min="5" max="160" step="1"></label>
            <label class="mini">Giro <input id="ed-cap-rot" type="range" min="-180" max="180" step="1"></label>
            <label class="mini">Opacidad <input id="ed-cap-op" type="range" min="10" max="100" step="1"></label>
            <div class="fila">
              <button id="ed-cap-atras" class="secundario">Atrás</button>
              <button id="ed-cap-delante" class="secundario">Delante</button>
              <button id="ed-cap-borrar" class="peligro">Quitar</button>
            </div>
          </div>

          <div class="pie">
            <button id="ed-eliminar" class="peligro">Eliminar</button>
            <span class="hueco"></span>
            <button id="ed-cancelar" class="secundario">Cancelar</button>
            <button id="ed-guardar" class="primario">Guardar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(raiz);
    el.raiz = raiz;

    for (const k of ['vista', 'ayuda', 'nombre', 'ruta', 'quitar-ruta', 'ruta-txt', 'buscar', 'lisas',
      'pack', 'anadir', 'capas', 'capa-ctl', 'cap-w', 'cap-rot', 'cap-op', 'imagen', 'marcos',
      'fam-botella', 'fam-libro', 'lomo',
      'cap-atras', 'cap-delante', 'cap-borrar', 'eliminar', 'cancelar', 'guardar']) {
      el[k] = raiz.querySelector(`#ed-${k}`);
    }

    el.nombre.addEventListener('input', () => { borrador.nombre = el.nombre.value; });

    el.marcos.innerHTML = Object.entries(Carteles.MARCOS)
      .map(([k, n]) => `<button class="marco-op" data-marco="${k}">${n}</button>`).join('');
    el.marcos.addEventListener('click', (e) => {
      const b = e.target.closest('[data-marco]');
      if (!b) return;
      borrador.marco = b.dataset.marco;
      pintar();
    });

    el.imagen.addEventListener('click', async () => {
      const elegidas = await window.estanteria.importarImagenes();
      if (!elegidas || !elegidas.length) return;
      ctx.imagenes[elegidas[0].id] = elegidas[0].datos;
      borrador.img = elegidas[0].id;
      borrador.ar = await proporcion(elegidas[0].datos);
      pintar();
    });

    el.buscar.addEventListener('input', () => {
      filtro = el.buscar.value.trim();
      if (filtro && soloLisas) { soloLisas = false; el.lisas.setAttribute('aria-pressed', 'false'); }
      pintarPack();
    });
    el.lisas.addEventListener('click', () => {
      soloLisas = !soloLisas;
      el.lisas.setAttribute('aria-pressed', String(soloLisas));
      pintarPack();
    });
    for (const b of [el['fam-botella'], el['fam-libro']]) {
      b.addEventListener('click', () => cambiarFamilia(b.dataset.familia));
    }

    el.lomo.addEventListener('input', () => {
      borrador.grafico.texto = el.lomo.value;
      pintar(true);
    });

    el.pack.addEventListener('click', (e) => {
      const b = e.target.closest('[data-base]');
      if (!b) return;
      borrador.grafico.base = b.dataset.base;
      pintar();
      pintarPack();
      b.scrollIntoView({ block: 'nearest' });
    });

    el.ruta.addEventListener('click', async () => {
      const r = await window.estanteria.elegirCarpeta();
      if (!r) return;
      borrador.ruta = r.ruta;
      if (!el.nombre.value.trim()) { borrador.nombre = r.nombre; el.nombre.value = r.nombre; }
      pintarRuta();
    });
    el['quitar-ruta'].addEventListener('click', () => { borrador.ruta = null; pintarRuta(); });

    el.anadir.addEventListener('click', async () => {
      for (const img of (await window.estanteria.importarImagenes()) || []) {
        await agregarCapa(img.id, img.datos);
      }
    });

    el['cap-w'].addEventListener('input', () => { capaSel().w = el['cap-w'].value / 100; pintar(true); });
    el['cap-rot'].addEventListener('input', () => { capaSel().rot = Number(el['cap-rot'].value); pintar(true); });
    el['cap-op'].addEventListener('input', () => { capaSel().op = el['cap-op'].value / 100; pintar(true); });
    el['cap-borrar'].addEventListener('click', () => {
      borrador.grafico.capas = borrador.grafico.capas.filter((c) => c.id !== seleccion);
      seleccion = null;
      pintar();
    });
    el['cap-delante'].addEventListener('click', () => reordenar(1));
    el['cap-atras'].addEventListener('click', () => reordenar(-1));

    el.capas.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cap]');
      if (!b) return;
      seleccion = b.dataset.cap;
      pintar();
    });

    el.cancelar.addEventListener('click', cerrar);
    el.guardar.addEventListener('click', () => {
      // Dejar el nombre en blanco no renombra la carpeta a "Sin nombre".
      borrador.nombre = (el.nombre.value || '').trim() || ctx.item.nombre || 'Sin nombre';
      ctx.alGuardar(borrador);
      cerrar();
    });
    el.eliminar.addEventListener('click', () => {
      if (ctx.alEliminar) ctx.alEliminar(borrador);
      cerrar();
    });

    raiz.addEventListener('pointerdown', (e) => { if (e.target === raiz) cerrar(); });
    window.addEventListener('keydown', (e) => {
      if (!raiz.hidden && e.key === 'Escape') { e.stopPropagation(); cerrar(); }
    }, true);

    ['dragenter', 'dragover'].forEach((ev) => el.vista.addEventListener(ev, (e) => {
      e.preventDefault(); el.vista.classList.add('encima');
    }));
    ['dragleave', 'drop'].forEach((ev) => el.vista.addEventListener(ev, () => el.vista.classList.remove('encima')));
    el.vista.addEventListener('drop', async (e) => {
      e.preventDefault();
      for (const f of e.dataTransfer.files) {
        if (!f.type.startsWith('image/')) continue;
        const guardada = await window.estanteria.guardarImagen(f.name, await leerDataURL(f));
        if (!guardada) continue;
        if (ctx.tipo === 'poster') {
          ctx.imagenes[guardada.id] = guardada.datos;
          borrador.img = guardada.id;
          borrador.ar = await proporcion(guardada.datos);
          pintar();
        } else {
          await agregarCapa(guardada.id, guardada.datos);
        }
      }
    });

    el.vista.addEventListener('pointerdown', alPulsarVista);
    el.vista.addEventListener('wheel', (e) => {
      if (!seleccion || ctx.tipo === 'poster') return;
      e.preventDefault();
      const c = capaSel();
      c.w = Math.min(1.6, Math.max(0.05, c.w - Math.sign(e.deltaY) * 0.04));
      pintar(true);
      clearTimeout(el.temporizador);
      el.temporizador = setTimeout(() => pintar(), 180);
    }, { passive: false });

    montado = true;
  }

  const leerDataURL = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const capaSel = () => borrador.grafico.capas.find((c) => c.id === seleccion) || {};

  const familia = () => Botellas.familiaDe(borrador.grafico);

  /** Cambia entre botella y libro, buscando un dibujo de la familia nueva. */
  function cambiarFamilia(nueva) {
    if (familia() === nueva) return;
    borrador.grafico.tipo = nueva;
    const dentro = Botellas.lista(nueva);
    if (!dentro.some((p) => p.id === borrador.grafico.base)) {
      const sugerida = nueva === 'libro'
        ? Botellas.graficoPorDefecto(borrador.nombre.length, 'libro').base
        : Botellas.sugerirBase(borrador.nombre);
      borrador.grafico.base = sugerida;
    }
    filtro = '';
    el.buscar.value = '';
    pintar();
    pintarPack();
  }

  function reordenar(dir) {
    const cs = borrador.grafico.capas;
    const i = cs.findIndex((c) => c.id === seleccion);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cs.length) return;
    [cs[i], cs[j]] = [cs[j], cs[i]];
    pintar();
  }

  async function agregarCapa(idImagen, datos) {
    ctx.imagenes[idImagen] = datos;
    const ar = await proporcion(datos);
    const capa = { id: uid(), img: idImagen, x: 0.5, y: 0.58, w: 0.5, rot: 0, op: 1, ar };
    borrador.grafico.capas.push(capa);
    seleccion = capa.id;
    pintar();
  }

  const proporcion = (datos) => new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i.naturalWidth / i.naturalHeight || 1);
    i.onerror = () => res(1);
    i.src = datos;
  });

  // --- Arrastre de capas -------------------------------------------------

  function alPulsarVista(e) {
    if (ctx.tipo === 'poster') return;
    const svg = el.vista.querySelector('svg');
    if (!svg) return;
    if (e.target.dataset?.capa) seleccion = e.target.dataset.capa;
    if (!seleccion) return;

    const caja = svg.getBoundingClientRect();
    const c = capaSel();
    arrastre = {
      caja,
      dx: (e.clientX - caja.left) / caja.width - c.x,
      dy: (e.clientY - caja.top) / caja.height - c.y,
    };
    el.vista.setPointerCapture(e.pointerId);
    el.vista.addEventListener('pointermove', moverCapa);
    el.vista.addEventListener('pointerup', soltarCapa);
    pintar();
  }

  function moverCapa(e) {
    if (!arrastre || !seleccion) return;
    const c = capaSel();
    c.x = Math.min(1.3, Math.max(-0.3, (e.clientX - arrastre.caja.left) / arrastre.caja.width - arrastre.dx));
    c.y = Math.min(1.3, Math.max(-0.3, (e.clientY - arrastre.caja.top) / arrastre.caja.height - arrastre.dy));
    pintar(true);
  }

  function soltarCapa(e) {
    arrastre = null;
    el.vista.removeEventListener('pointermove', moverCapa);
    el.vista.removeEventListener('pointerup', soltarCapa);
    try { el.vista.releasePointerCapture(e.pointerId); } catch (_) { /* nada */ }
    pintar();
  }

  // --- Pintado -----------------------------------------------------------

  function pintarRuta() {
    const hay = Boolean(borrador.ruta);
    el['ruta-txt'].textContent = hay ? borrador.ruta : 'Sin vincular';
    el['ruta-txt'].title = hay ? borrador.ruta : '';
    el['quitar-ruta'].hidden = !hay;
    el.ruta.textContent = hay ? 'Cambiar carpeta…' : 'Elegir carpeta…';
  }

  function pintarPack() {
    const q = sinTildes(filtro);
    const fam = familia();
    const lista = Botellas.lista(fam).filter((p) => {
      if (q) return sinTildes(p.nombre).includes(q);
      return fam === 'botella' && soloLisas ? p.lisa : true;
    });

    el.raiz.dataset.familia = fam;
    el.lisas.hidden = fam !== 'botella';
    for (const b of [el['fam-botella'], el['fam-libro']]) {
      b.setAttribute('aria-pressed', String(b.dataset.familia === fam));
    }

    el.pack.innerHTML = lista.map((p) => `
      <button class="pieza ${p.id === borrador.grafico.base ? 'sel' : ''}"
              data-base="${esc(p.id)}" title="${esc(p.nombre)}">
        <img src="${esc(p.src)}" alt="" loading="lazy">
      </button>`).join('')
      || '<p class="vacio">Ninguna botella con ese nombre.</p>';
  }

  /** soloVista: durante el arrastre solo se redibuja la botella, no las listas. */
  function pintar(soloVista = false) {
    if (ctx.tipo === 'poster') {
      el.vista.innerHTML = `<div class="poster-previa">${Carteles.html(borrador, ctx.imagenes)}</div>`;
      for (const b of el.marcos.querySelectorAll('[data-marco]')) {
        b.setAttribute('aria-pressed', String(b.dataset.marco === (borrador.marco || 'madera')));
      }
      el.ayuda.textContent = 'Arrastra otra imagen aquí para cambiar la lámina.';
      return;
    }

    el.vista.innerHTML = Botellas.svg(borrador.grafico, {
      uid: 'ed-' + limpioId(borrador.id),
      imagenes: ctx.imagenes,
      seleccion,
      texto: borrador.grafico.texto ?? borrador.nombre,
    });
    if (soloVista) return;

    el.capas.innerHTML = borrador.grafico.capas.map((c, i) => `
      <button class="capa ${c.id === seleccion ? 'sel' : ''}" data-cap="${esc(c.id)}">
        <img src="${esc(ctx.imagenes[c.img] || '')}" alt="">
        <span>${i + 1}</span>
      </button>`).join('')
      || '<p class="vacio">Arrastra un archivo sobre la botella.</p>';

    const c = borrador.grafico.capas.find((x) => x.id === seleccion);
    el['capa-ctl'].hidden = !c;
    if (c) {
      el['cap-w'].value = Math.round(c.w * 100);
      el['cap-rot'].value = c.rot || 0;
      el['cap-op'].value = Math.round((c.op ?? 1) * 100);
    }

    el.ayuda.textContent = borrador.grafico.capas.length
      ? 'Arrastra la imagen sobre la botella. Rueda del ratón para el tamaño.'
      : 'Arrastra una imagen aquí y se recortará al contorno de la botella.';
  }

  // --- API ----------------------------------------------------------------

  function abrir(opciones) {
    if (!montado) montar();

    ctx = opciones;
    ctx.tipo = opciones.tipo || 'botella';
    el.raiz.dataset.tipo = ctx.tipo;
    borrador = JSON.parse(JSON.stringify(opciones.item));
    if (ctx.tipo === 'botella') {
      borrador.grafico = borrador.grafico || Botellas.graficoPorDefecto();
      borrador.grafico.capas = borrador.grafico.capas || [];
    } else {
      borrador.marco = borrador.marco || 'madera';
    }
    seleccion = null;
    filtro = '';
    el.buscar.value = '';
    if (ctx.tipo === 'botella') {
      soloLisas = !borrador.grafico.base || Boolean(Botellas.base(borrador.grafico.base)?.lisa);
      el.lisas.setAttribute('aria-pressed', String(soloLisas));
      el.lomo.value = borrador.grafico.texto ?? '';
    }

    el.nombre.value = borrador.nombre || '';
    el.eliminar.hidden = !opciones.alEliminar;
    el.guardar.textContent = opciones.esNueva ? 'Crear' : 'Guardar';
    pintarRuta();
    pintar();
    if (ctx.tipo === 'botella') pintarPack();

    el.raiz.hidden = false;
    el.nombre.focus();
    el.nombre.select();
  }

  function cerrar() {
    if (el.raiz) el.raiz.hidden = true;
    ctx = null;
    borrador = null;
    seleccion = null;
  }

  const abierto = () => montado && !el.raiz.hidden;

  return { abrir, cerrar, abierto };
})();

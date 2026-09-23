'use strict';

/* ------------------------------------------------------------------
   Pósters: láminas pegadas en la pared, detrás de las botellas.

   A diferencia de las botellas no se posan en ninguna balda: van donde
   los sueltes. El marco es puro CSS para que combine con el dibujo plano
   del fondo.
   ------------------------------------------------------------------ */

const Carteles = (() => {

  const MARCOS = {
    ninguno: 'Sin marco',
    madera: 'Marco',
    polaroid: 'Polaroid',
    cinta: 'Con celo',
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Marcado interior de un póster (sin posicionar). */
  function html(p, imagenes = {}) {
    const datos = imagenes[p.img] || '';
    const marco = MARCOS[p.marco] ? p.marco : 'madera';
    return `<div class="lamina marco-${marco}">
      <img src="${esc(datos)}" alt="" draggable="false">
    </div>`;
  }

  return { MARCOS, html };
})();

'use strict';

/**
 * Sustituir el escritorio en Linux.
 *
 * Cada entorno dibuja sus iconos del escritorio con un programa distinto. Para
 * que la estantería SEA el escritorio, mientras está abierta se apagan esos
 * iconos, y al salir se deja todo exactamente como estaba. Lo que se cambia se
 * apunta en un archivo antes de tocarlo: si la app se cierra de golpe, en el
 * siguiente arranque se restaura igual.
 *
 *   GNOME / Ubuntu   extensión Desktop Icons NG (ding) u otras parecidas
 *   XFCE             xfdesktop: estilo de iconos
 *   Cinnamon         Nemo: disposición del escritorio
 *   MATE             Caja: show-desktop-icons
 *   KDE Plasma       se configura a mano (Plasma no deja cambiarlo por script)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let entorno = process.env;
let ficheroNotas = null;

function configurar({ env, dirDatos }) {
  entorno = env || process.env;
  ficheroNotas = path.join(dirDatos, 'escritorio-original.json');
}

/** Ejecuta y devuelve la salida (texto), o null si falla o no existe. */
function correr(cmd, args) {
  try {
    return String(execFileSync(cmd, args, { env: entorno, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch (_) {
    return null;
  }
}

const escritorioActual = () => String(entorno.XDG_CURRENT_DESKTOP || '').toLowerCase();

// --- Cada entorno --------------------------------------------------------

const EXTENSIONES_ICONOS = [
  'ding@rastersoft.com',              // Ubuntu y Desktop Icons NG
  'gtk4-ding@smedius.gitlab.com',     // DING para GNOME 45+
  'desktopicons-neo@darkdemon',
  'desktop-icons@csoriano',           // la antigua
];

const entornos = [
  {
    nombre: 'GNOME',
    hay: () => /gnome|unity|ubuntu|pop/.test(escritorioActual()) && correr('gnome-extensions', ['--version']) !== null,
    ocultar() {
      const activas = (correr('gnome-extensions', ['list', '--enabled']) || '').split('\n').map((s) => s.trim());
      const apagadas = EXTENSIONES_ICONOS.filter((u) => activas.includes(u));
      for (const u of apagadas) correr('gnome-extensions', ['disable', u]);
      return apagadas.length ? { apagadas } : null;
    },
    restaurar(n) { for (const u of n.apagadas || []) correr('gnome-extensions', ['enable', u]); },
  },
  {
    nombre: 'XFCE',
    hay: () => /xfce/.test(escritorioActual()) && correr('xfconf-query', ['--version']) !== null,
    ocultar() {
      const antes = correr('xfconf-query', ['-c', 'xfce4-desktop', '-p', '/desktop-icons/style']);
      if (antes === '0') return null;   // ya estaban quitados
      correr('xfconf-query', ['-c', 'xfce4-desktop', '-p', '/desktop-icons/style', '-n', '-t', 'int', '-s', '0']);
      return { estilo: antes ?? '2' };
    },
    restaurar(n) { correr('xfconf-query', ['-c', 'xfce4-desktop', '-p', '/desktop-icons/style', '-s', String(n.estilo ?? 2)]); },
  },
  {
    nombre: 'Cinnamon',
    hay: () => /cinnamon|x-cinnamon/.test(escritorioActual()),
    ocultar() {
      const disp = correr('gsettings', ['get', 'org.nemo.desktop', 'desktop-layout']);
      if (disp !== null) {
        if (disp === "'false::false'") return null;
        correr('gsettings', ['set', 'org.nemo.desktop', 'desktop-layout', 'false::false']);
        return { clave: 'desktop-layout', antes: disp.replace(/^'|'$/g, '') };
      }
      const ver = correr('gsettings', ['get', 'org.nemo.desktop', 'show-desktop-icons']);
      if (ver !== 'true') return null;
      correr('gsettings', ['set', 'org.nemo.desktop', 'show-desktop-icons', 'false']);
      return { clave: 'show-desktop-icons', antes: 'true' };
    },
    restaurar(n) { correr('gsettings', ['set', 'org.nemo.desktop', n.clave, n.antes]); },
  },
  {
    nombre: 'MATE',
    hay: () => /mate/.test(escritorioActual()),
    ocultar() {
      if (correr('gsettings', ['get', 'org.mate.background', 'show-desktop-icons']) !== 'true') return null;
      correr('gsettings', ['set', 'org.mate.background', 'show-desktop-icons', 'false']);
      return { antes: 'true' };
    },
    restaurar(n) { correr('gsettings', ['set', 'org.mate.background', 'show-desktop-icons', n.antes || 'true']); },
  },
];

// --- Notas de lo que se cambió ---------------------------------------------

function leerNotas() {
  try { return JSON.parse(fs.readFileSync(ficheroNotas, 'utf8')); } catch (_) { return null; }
}

function guardarNotas(n) {
  try {
    fs.mkdirSync(path.dirname(ficheroNotas), { recursive: true });
    fs.writeFileSync(ficheroNotas, JSON.stringify(n, null, 2), 'utf8');
  } catch (_) { /* sin notas, al menos lo intentamos */ }
}

function borrarNotas() {
  try { fs.rmSync(ficheroNotas, { force: true }); } catch (_) { /* nada */ }
}

// --- API -------------------------------------------------------------------

/**
 * Apaga los iconos del escritorio del sistema.
 * @returns {{ok: boolean, entorno: string|null, detalle?: string}}
 */
function ocultarIconos() {
  if (leerNotas()) return { ok: true, entorno: leerNotas().entorno };   // ya apagados
  const e = entornos.find((x) => { try { return x.hay(); } catch (_) { return false; } });
  if (!e) {
    const kde = /kde|plasma/.test(escritorioActual());
    return {
      ok: false,
      entorno: kde ? 'KDE' : null,
      detalle: kde
        ? 'En KDE Plasma: clic derecho en el escritorio → Configurar el escritorio y el fondo → Diseño: «Escritorio» (en vez de «Vista de carpeta»).'
        : 'No se reconoce el entorno de escritorio; si tiene iconos propios, desactívalos en sus ajustes.',
    };
  }
  // Primero se apunta, luego se toca: así nunca queda nada sin poder deshacer.
  guardarNotas({ entorno: e.nombre, cambios: null });
  let cambios = null;
  try { cambios = e.ocultar(); } catch (_) { /* nada */ }
  if (!cambios) { borrarNotas(); return { ok: true, entorno: e.nombre, detalle: 'No había iconos que quitar.' }; }
  guardarNotas({ entorno: e.nombre, cambios });
  return { ok: true, entorno: e.nombre };
}

/** Deja los iconos del sistema como estaban antes de abrir la estantería. */
function restaurarIconos() {
  const n = leerNotas();
  if (!n) return false;
  const e = entornos.find((x) => x.nombre === n.entorno);
  if (e && n.cambios) { try { e.restaurar(n.cambios); } catch (_) { /* nada */ } }
  borrarNotas();
  return true;
}

module.exports = { configurar, ocultarIconos, restaurarIconos };

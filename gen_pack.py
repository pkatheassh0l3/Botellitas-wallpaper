"""Convierte un pack de botellas en .ico a los PNG que usa la app.

    python3 gen_pack.py ruta/a/la/carpeta/con/los/ico

Toma el fotograma de 256x256 de cada .ico, recorta el transparente sobrante
(la app mide el ancho real para que las botellas no se solapen) y deja el
resultado en assets/pack/, junto con un nombres.json que conserva el nombre
original de cada archivo.
"""
import glob
import json
import os
import re
import sys
import unicodedata

from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
DESTINO = os.path.join(BASE, "assets", "pack")


def slug(nombre):
    n = unicodedata.normalize("NFKD", nombre).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", n).strip("-").lower() or "botella"


def convertir(origen):
    os.makedirs(DESTINO, exist_ok=True)
    nombres = {}
    ruta_indice = os.path.join(DESTINO, "nombres.json")
    if os.path.exists(ruta_indice):
        with open(ruta_indice, encoding="utf-8") as f:
            nombres = json.load(f)

    ok = fallos = 0
    for fichero in sorted(glob.glob(os.path.join(origen, "*.ico"))):
        etiqueta = os.path.splitext(os.path.basename(fichero))[0]
        try:
            im = Image.open(fichero)
            im.size = (256, 256)          # pide el fotograma grande del .ico
            im = im.convert("RGBA")
            caja = im.getbbox()
            if caja:
                im = im.crop(caja)

            salida = f"{slug(etiqueta)}.png"
            i = 1
            while salida in nombres and nombres[salida] != etiqueta:
                salida = f"{slug(etiqueta)}-{i}.png"
                i += 1

            im.save(os.path.join(DESTINO, salida), optimize=True)
            nombres[salida] = etiqueta
            ok += 1
        except Exception as e:                                  # noqa: BLE001
            fallos += 1
            print(f"  no se pudo convertir {etiqueta}: {e}")

    nombres = {k: v for k, v in sorted(nombres.items())
               if os.path.exists(os.path.join(DESTINO, k))}
    with open(ruta_indice, "w", encoding="utf-8") as f:
        json.dump(nombres, f, ensure_ascii=False, indent=1)

    print(f"{ok} botellas en assets/pack" + (f", {fallos} fallidas" if fallos else ""))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Uso: python3 gen_pack.py <carpeta con los .ico>")
    convertir(sys.argv[1])

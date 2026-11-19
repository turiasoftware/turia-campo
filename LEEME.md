# Turia Campo

## Instalar en el iPhone

1. Descomprime el paquete. Publica la carpeta que contiene `index.html` en un alojamiento estático con HTTPS. En Netlify se puede arrastrar esa carpeta al despliegue manual. En GitHub Pages, coloca su contenido en la carpeta publicada del repositorio. Todas las rutas del proyecto son relativas.
2. Abre la dirección HTTPS en Safari. En Compartir, elige **Añadir a la pantalla de inicio** y, si aparece, activa **Abrir como app web**.
3. Abre Turia Campo desde ese icono, con conexión la primera vez. En **Herramientas** puedes comprobar que el arranque sin cobertura está preparado. Usa esa misma instalación durante la campaña.
4. Pulsa **Activar GPS** y permite la ubicación precisa. Para registrar orientación, pulsa **Herramientas → Habilitar brújula del iPhone**. Si el dispositivo no facilita un rumbo válido y reciente, el campo queda vacío.

## Tomar un punto

Selecciona el tipo y pulsa **Fijar punto + foto**. El gesto fija la posición, la fecha, la precisión y el último rumbo válido, reserva el código de su serie y abre el selector de cámara trasera. Haz la foto, añade notas y pulsa **Guardar punto y foto**. El mapa y el inventario permiten abrir la ficha y guiarse hacia ella. La guía expresa el ángulo en sentido horario desde el norte de cuadrícula UTM. El rumbo guardado en el punto procede de la brújula del dispositivo.

Para promediar, mantén el móvil quieto y pulsa **Herramientas → Promediar posición (15 s)**. Se excluyen lecturas con precisión superior a 25 m y marcas temporales duplicadas. Se necesitan dos muestras válidas como mínimo. La media de X e Y se pondera por el inverso del cuadrado del radio de precisión. La precisión mostrada es una estimación conservadora que incorpora la dispersión entre muestras. Cuando aparezca **POSICIÓN PROMEDIADA**, pulsa el botón de captura. La media caduca a los 20 s desde la última muestra o al detectar desplazamiento. Una captura ordinaria exige una lectura de los últimos 15 s.

Punto y foto se escriben juntos en IndexedDB. Una captura interrumpida puede dejar un salto de numeración. Los datos pertenecen al sitio y al dispositivo. Exporta la campaña antes de cambiar de dominio, borrar los datos de Safari o retirar la instalación.

## Mapas y medición

El encuadre inicial está en Teruel. Al activar el GPS, el mapa sigue la posición. Arrastrar el mapa suspende el seguimiento y el botón de localización lo recupera. Catastro y recintos SIGPAC se muestran desde zoom 15. La opacidad inicial de Catastro es del 30 %.

**Consultar centro** usa la cruz central. Las fichas también ofrecen consultas en su punto. Las peticiones de información emplean EPSG:25830 y se abren directamente en el servicio oficial, de modo que la lectura no depende de permisos CORS. Los fondos WMTS y las imágenes WMS se dibujan en la cuadrícula web del mapa.

**Medir** permite elegir una línea o un polígono. Toca el mapa para añadir vértices y **Detalle** para ver cada tramo. Los polígonos cierran automáticamente al tercer vértice. La superficie se expresa en m² y ha. Las medidas son planas en ETRS89 / UTM 30N en toda la península.

## Llevar los datos al estudio

En **Inventario** o **Herramientas**, pulsa **Exportar ZIP**. El enlace de descarga permanece disponible en el panel si Safari requiere otro toque. En Archivos puedes descomprimirlo.

- `puntos_utm30.geojson` lleva geometrías WGS84 en orden longitud, latitud y atributos X_UTM30 e Y_UTM30 en metros.
- `puntos_utm30.csv` utiliza UTF-8 con BOM, separador de campos de punto y coma y coma decimal. En QGIS, selecciona X_UTM30 e Y_UTM30, activa **El separador decimal es la coma** y asigna EPSG:25830. La fecha se guarda en formato ISO 8601 UTC.
- `FOTOS/` conserva los archivos originales. El campo archivo_foto es la ruta relativa exacta dentro del ZIP.

El service worker guarda la aplicación y sus dependencias tras la primera carga. Con el móvil sin cobertura puedes inventariar, consultar puntos guardados y exportar. Las teselas y las consultas oficiales necesitan red. La disponibilidad del GPS depende de la señal y de los permisos.

## Archivos

`index.html`, `campo.css` y `campo.js` contienen la interfaz y la lógica. `manifest.json`, `sw.js` y los iconos PNG permiten instalar la PWA. La carpeta `vendor/` contiene Leaflet 1.9.4, Proj4js 2.12.1 y JSZip 3.10.1 con sus licencias, distribuidas desde jsDelivr. El HTML incluye sus URL de reserva con versión fijada. No hay compilación, claves de API ni backend.

Al modificar los archivos para otro despliegue, incrementa la versión de CACHE en `sw.js`. Cierra todas las ventanas de la aplicación y vuelve a abrir para activar la actualización.

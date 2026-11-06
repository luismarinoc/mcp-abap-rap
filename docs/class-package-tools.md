# Inclusiones de clases y ayudas de paquetes

`classIncludes` recibe `{ "clas": "ZCL_DEMO" }`. Consulta la estructura de la clase en ADT y devuelve `status: "success"` y `result`, un objeto cuyas claves son los tipos de inclusión (`main`, `definitions`, etc.) y cuyos valores son URLs de fuente. Si la estructura no contiene inclusiones, `result` es `{}`. Un fallo al consultar ADT produce un error MCP, no un resultado exitoso.

`packageSearchHelp` recibe `type` y opcionalmente `name` (por ejemplo `{ "type": "applicationcomponents", "name": "Z*" }`). Tipos admitidos: `applicationcomponents`, `softwarecomponents`, `transportlayers` y `translationrelevances`. Un tipo no admitido produce `InvalidParams` antes de consultar SAP. El resultado exitoso conserva `status: "success"` y la lista devuelta por el SDK en `result`.

La validación evita rutas de ayuda inválidas, pero **no garantiza que el endpoint exista** en cada sistema SAP: un 404 remoto para un tipo admitido sigue siendo un error de consulta. Ninguna de estas herramientas modifica objetos SAP.

# Usar la misma instalación en todos los clientes

Los clientes que ejecutan `/Users/luismarinoc/projects/mcp-abap-rap/dist/index.js`
comparten la instalación local. Los archivos quedan guardados al apagar la máquina;
el MCP vuelve a iniciarse cuando el cliente abre su conexión. No es un servicio que
siga funcionando con la máquina apagada.

## Cargar una actualización

1. Terminá cualquier operación SAP en curso.
2. Desconectá y reconectá el servidor MCP en cada cliente. Si no tiene esa opción,
   cerrá completamente la aplicación y volvé a abrirla.
3. Actualizá la lista de herramientas si el cliente conserva una copia en caché.

No hace falta volver a editar las rutas de los clientes que ya usan el mismo archivo.
Los procesos abiertos antes de una actualización pueden conservar código anterior;
cambiar el archivo no reinicia esas conexiones.

## Comprobar la versión cargada sin modificar SAP

Pedile al cliente:

> Consultá la lista real de herramientas del servidor MCP SAP, sin ejecutar ninguna
> operación de creación. Confirmá que aparece `createFullRapService`, que `objectTypes`
> acepta `filter`, y que `searchObject` acepta `offset` y `pageSize`.

Las herramientas visibles deben provenir del servidor, no de una respuesta de memoria
del modelo. No ejecutes `createFullRapService` para comprobar la instalación: su modo
normal crea objetos SAP.

Para una comprobación funcional de solo lectura, con una sesión SAP válida:

```json
{"filter":"BDEF"}
```

Usá esos argumentos con `objectTypes`. Los resultados deben coincidir, sin distinguir
mayúsculas, con `BDEF` en tipo, nombre o descripción. Un resultado vacío puede ser
válido según los tipos expuestos por SAP. Una conexión SAP fallida no prueba por sí
sola que la instalación local sea incorrecta.

## Comprobar el archivo local

```sh
shasum -a 256 /Users/luismarinoc/projects/mcp-abap-rap/dist/index.js
```

Huella de la activación verificada del 6 de noviembre de 2026:

```text
8ee0c7a5e643e9a7fec05cbc94dfb2dc7ea581e5dffc18b509b3dcf0ef014da8
```

Compará el resultado con esa huella. Esta comprobación identifica el archivo en disco;
la lista real de herramientas confirma qué cargó cada cliente. Una actualización
posterior legítima cambiará la huella.
El registro local de preparación e instalación queda en `.local-builds/`; los respaldos
verificados quedan en `.local-backups/`. El respaldo previo a esta activación es
`.local-backups/pre-persistent-activation-20261106T035209Z/` (tar, manifiesto y directorio
anterior conservado). Pasaron 97 pruebas offline y la comprobación independiente del
MCP compilado; esta activación no ejecutó pruebas nuevas contra SAP real.
No restaures un respaldo completo sobre el
proyecto: la recuperación debe limitarse al ejecutable identificado.

#!/bin/bash
# Activa mcp-abap-rap en Claude Desktop y migra las credenciales a un .env
# unico en la carpeta del proyecto. Doble clic para ejecutar.

PROY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo ""
echo "=== Activando mcp-abap-rap ==="
echo ""

if [ ! -f "$PROY/dist/index.js" ]; then
  echo "No existe el compilado. Compilando..."
  cd "$PROY" && npm install --silent && npm run build || { echo "FALLO la compilacion"; read -n1; exit 1; }
fi

if [ ! -f "$CFG" ]; then
  echo "No encuentro la configuracion de Claude en:"; echo "$CFG"; read -n1; exit 1
fi

python3 - "$CFG" "$PROY" <<'PY'
import json, shutil, sys, os, datetime

cfg, proy = sys.argv[1], sys.argv[2]
envfile = os.path.join(proy, ".env")

shutil.copy(cfg, cfg + ".bak-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
d = json.load(open(cfg))
srv = d.setdefault("mcpServers", {})

# 1. Reunir credenciales: primero las del .env existente, luego las del config
vals = {}
if os.path.exists(envfile):
    for line in open(envfile):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip()

for nombre in ("sap-bash-adt", "sap-adt"):
    for k, v in (srv.get(nombre, {}).get("env") or {}).items():
        if v:
            vals[k] = v

vals.setdefault("SAP_LANGUAGE", "ES")

faltan = [k for k in ("SAP_URL", "SAP_USER", "SAP_PASSWORD") if not vals.get(k)]
if faltan:
    print("FALTAN credenciales: " + ", ".join(faltan))
    print("Editalas a mano en: " + envfile)
    for k in faltan:
        vals[k] = "PONER_AQUI"

# 2. Escribir el .env, solo legible por ti
with open(envfile, "w") as f:
    f.write("# Credenciales del MCP. Unico lugar donde viven.\n")
    f.write("# Los clientes MCP ya no las necesitan en su configuracion.\n\n")
    for k in ("SAP_URL", "SAP_CLIENT", "SAP_USER", "SAP_PASSWORD", "SAP_LANGUAGE"):
        if vals.get(k):
            f.write(f"{k}={vals[k]}\n")
os.chmod(envfile, 0o600)

# 3. Semilla de clientes.json a partir de lo que ya hay
clientes = os.path.join(proy, "clientes.json")
if not os.path.exists(clientes):
    json.dump({
        "porDefecto": "default",
        "clientes": {
            "default": {
                "descripcion": "Migrado desde la configuracion anterior",
                "url": vals.get("SAP_URL", ""),
                "mandante": vals.get("SAP_CLIENT", ""),
                "usuario": vals.get("SAP_USER", ""),
                "password": vals.get("SAP_PASSWORD", ""),
                "idioma": vals.get("SAP_LANGUAGE", "ES")
            }
        }
    }, open(clientes, "w"), indent=2, ensure_ascii=False)
    os.chmod(clientes, 0o600)
    print("Creado clientes.json con el sistema actual. Agrega ahi los demas.")
else:
    # Rellenar passwords vacias cuando la URL coincide con la ya configurada
    reg = json.load(open(clientes))
    tocado = False
    for nom, c in reg.get("clientes", {}).items():
        if not c.get("password") and c.get("url") == vals.get("SAP_URL"):
            c["password"] = vals.get("SAP_PASSWORD", "")
            tocado = True
            print(f"Password de '{nom}' completada desde la configuracion anterior.")
    if tocado:
        json.dump(reg, open(clientes, "w"), indent=2, ensure_ascii=False)
        os.chmod(clientes, 0o600)
    else:
        print("clientes.json ya existia, no se toco.")

# 4. Config sin credenciales
srv["sap-bash-adt"] = {"command": "node", "args": [proy + "/dist/index.js"]}

json.dump(d, open(cfg, "w"), indent=2, ensure_ascii=False)
print("Credenciales migradas a .env (permisos 600).")
print("Configuracion de Claude actualizada, ya sin password dentro.")
PY

echo ""
echo "Matando el servidor viejo si esta corriendo..."
pkill -f "mcp-abap-abap-adt-api" 2>/dev/null
pkill -f "mcp-abap-rap/dist/index.js" 2>/dev/null

echo ""
echo "=========================================="
echo " LISTO."
echo " Cierra Claude con Command+Q y abrelo."
echo "=========================================="
echo ""
read -n1 -p "Pulsa una tecla para cerrar esta ventana..."

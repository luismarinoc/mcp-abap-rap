#!/bin/bash
# Genera una entrada MCP por cada cliente de clientes.json.
# Vuelve a ejecutarlo cada vez que agregues un cliente. Doble clic.

PROY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo ""
echo "=== Generando un MCP por cliente ==="
echo ""

python3 - "$CFG" "$PROY" <<'PY'
import json, os, shutil, sys, datetime

cfg, proy = sys.argv[1], sys.argv[2]
clientes_file = os.path.join(proy, "clientes.json")

if not os.path.exists(clientes_file):
    print("No existe clientes.json. Corre primero activar.command"); sys.exit(1)

reg = json.load(open(clientes_file))
clientes = reg.get("clientes", {})
if not clientes:
    print("clientes.json no tiene clientes definidos"); sys.exit(1)

# node absoluto, para que funcione en cualquier cliente MCP
node = shutil.which("node") or os.path.expanduser("~/.local/bin/node")

shutil.copy(cfg, cfg + ".bak-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
d = json.load(open(cfg))
srv = d.setdefault("mcpServers", {})

# Limpiar las entradas generadas antes por este script
for k in [k for k, v in srv.items() if isinstance(v, dict) and v.get("_generado") == "mcp-abap-rap"]:
    del srv[k]

creados = []
for nombre, c in clientes.items():
    key = "sap-" + nombre
    srv[key] = {
        "command": node,
        "args": [proy + "/dist/index.js"],
        "env": {"SAP_CLIENTE": nombre},
        "_generado": "mcp-abap-rap"
    }
    creados.append((key, c.get("descripcion", ""), c.get("url", "")))

json.dump(d, open(cfg, "w"), indent=2, ensure_ascii=False)

print("Entradas creadas:\n")
for k, desc, url in creados:
    print(f"  {k:<28} {desc or url}")
print(f"\nnode usado: {node}")
PY

echo ""
pkill -f "mcp-abap-rap/dist/index.js" 2>/dev/null

echo "=========================================="
echo " Cierra Claude con Command+Q y abrelo."
echo "=========================================="
echo ""
read -n1 -p "Pulsa una tecla para cerrar esta ventana..."
